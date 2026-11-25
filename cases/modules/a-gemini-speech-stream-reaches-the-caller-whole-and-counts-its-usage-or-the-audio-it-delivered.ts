// protects: server/modules/voice/gemini-wire.ts, server/modules/voice/gemini-usage-read.ts, server/modules/voice/gemini-speech.ts, server/modules/companion/companion-speech.ts, server/modules/gemini-meter/gemini-rates.ts
// writes: none
//
// The wire reads a speech answer without taking a byte from its caller, and counts it from what it carried. On a scratch
// database with a fake key in reach and fetch stood in for Google, the speech door speaks one sentence for one account
// whose stand-in stream carries 2 s of 24 kHz 16-bit PCM and a terminal usage, and one for another whose stream carries
// the same audio and no usage: both callers read all 96,000 bytes; the first account's companion_speech row is metered
// with the usage's tokens (the whole output as audio, no breakdown given); the second's is unmetered, its output audio
// tokens 2 s at the model's audioOutTokensPerSecond (none listed: no tokens). Nothing reaches Google.

import { broken, held, runCase } from "../lib/case.mjs";
import { addUser, todayUtc } from "../lib/gemini_meter.mjs";
import { KEY_TAIL, drain, pcmBytes, speechStream, wireGround } from "../lib/gemini_wire.mjs";

const VOICE = "../../server/modules/voice";
const SECONDS = 2;
const PCM_BYTES_PER_SECOND = 48000;
const STREAM_USAGE = { total_input_tokens: 12, total_output_tokens: 40 };

runCase(async (t: any) => {
  const g: any = await wireGround(t, "gemini-wire-speech");
  if (!g.meter) return broken(g.missing);
  const { synthesizeSentence } = await import(VOICE + "/gemini-speech.ts");
  const { readVoiceSettings } = await import(VOICE + "/voice-settings.ts");
  const pcm = pcmBytes(SECONDS * PCM_BYTES_PER_SECOND);
  const wrong: string[] = [];
  const speak = async (id: number, usage: object | null, what: string) => {
    g.answer = () => speechStream(pcm, usage);
    try {
      const answer: any = await synthesizeSentence(id, { text: "Hello there.", style: "", signal: new AbortController().signal, feature: "companion_speech" } as any);
      if (answer?.ok !== true) wrong.push(what + ": the door answered " + JSON.stringify({ reason: answer?.reason, sentence: answer?.sentence }).slice(0, 160));
      const heard = await drain(answer);
      if (answer?.ok === true && heard.bytes !== pcm.length) wrong.push(what + ": the caller read " + heard.bytes + " of the " + pcm.length + " PCM bytes the stream carried");
      return heard;
    } catch (error) {
      wrong.push(what + ": the door threw " + String((error as Error)?.message ?? error).split("\n")[0]);
      return { chunks: 0, bytes: 0 };
    }
  };
  const expect = (rows: any[], want: Record<string, unknown>, what: string) => {
    if (rows.length !== 1) {
      wrong.push(what + ": " + rows.length + " gemini_calls_daily rows, not 1");
      return;
    }
    for (const [column, value] of Object.entries(want)) {
      if (rows[0][column] !== value) wrong.push(what + ": " + column + " reads " + JSON.stringify(rows[0][column]) + ", not " + JSON.stringify(value));
    }
  };

  const metered = addUser(g.db, "case-speech-metered");
  const model = readVoiceSettings(metered).gemini.speechModel;
  const first = await speak(metered, STREAM_USAGE, "with usage");
  expect(await g.counted(metered, 1), {
    feature: "companion_speech", model, key_tail: KEY_TAIL, calls: 1, failures: 0, metered_calls: 1,
    input_tokens: 12, output_tokens: 40, input_audio_tokens: 0, output_audio_tokens: 40,
  }, "with usage");

  const unmetered = addUser(g.db, "case-speech-unmetered");
  const perSecond = typeof g.meter.rateFor === "function" ? (g.meter.rateFor(model, todayUtc())?.audioOutTokensPerSecond ?? null) : null;
  const derived = perSecond === null ? 0 : Math.round(SECONDS * perSecond);
  const second = await speak(unmetered, null, "without usage");
  expect(await g.counted(unmetered, 1), {
    feature: "companion_speech", model, calls: 1, failures: 0, metered_calls: 0,
    input_tokens: 0, output_tokens: derived, output_audio_tokens: derived,
  }, "without usage");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("the caller read " + first.bytes + " and " + second.bytes + " of " + pcm.length + " bytes; with usage: metered, 12 in, 40 out as audio; without: unmetered, 2 s at " + perSecond + " tokens/s = " + derived + " audio tokens (" + model + ")");
});
