// protects: server/modules/voice/gemini-wire.ts, server/modules/voice/gemini-speech.ts, server/modules/voice/gemini-transcribe.ts, server/modules/voice/gemini-read-aloud.ts, server/modules/voice/gemini-errors.ts, server/modules/gemini-meter/gemini-meter.service.ts, server/shared/types.ts
// writes: none
//
// A feature switched off is answered before anything is sent. On a scratch database with a fake key in reach and fetch
// stood in for Google, an account with companion_speech, read_aloud and backup_transcription switched off asks the speech
// door, the read-aloud door and the transcribing door: each answers reason off with "Gemini is switched off for <label>:
// turn it on in API → Gemini" (read-aloud with the status chatStatusForRefusal gives no_key), no request reaches the
// stand-in, no gemini_calls_daily row is written and no "[voice] gemini speech" line is logged. Nothing reaches Google.

import { broken, held, runCase } from "../lib/case.mjs";
import { addUser } from "../lib/gemini_meter.mjs";
import { CLIP, drain, pcmBytes, sleep, speechStream, transcriptReply, wireGround } from "../lib/gemini_wire.mjs";

const VOICE = "../../server/modules/voice";
const FEATURES = ["companion_speech", "read_aloud", "backup_transcription"];
const OFF_SENTENCE = /^Gemini is switched off for (.+): turn it on in API → Gemini$/;

runCase(async (t: any) => {
  const g: any = await wireGround(t, "gemini-wire-off");
  if (!g.meter) return broken(g.missing);
  const id = addUser(g.db, "case-wire-off");
  const now = new Date().toISOString();
  for (const feature of FEATURES) {
    g.db.prepare("INSERT INTO gemini_feature_switches (user_id, feature, enabled, updated_at) VALUES (?, ?, 0, ?)").run(id, feature, now);
  }
  // Were anything sent, the stand-in answers as Google would, so a door that ignores the switch reads as speaking, not failing.
  g.answer = (url: string) => (url.includes(":generateContent") ? transcriptReply("Hello there.", null) : speechStream(pcmBytes(4800), null));
  const { synthesizeSentence } = await import(VOICE + "/gemini-speech.ts");
  const { transcribeWithGemini } = await import(VOICE + "/gemini-transcribe.ts");
  const { synthesizeReadAloud } = await import(VOICE + "/gemini-read-aloud.ts");
  const { chatStatusForRefusal } = await import(VOICE + "/gemini-errors.ts");
  const labelOf = typeof g.meter.geminiFeatureLabel === "function" ? (f: string) => g.meter.geminiFeatureLabel(f) : null;

  const wrong: string[] = [];
  const logged: string[] = [];
  const realLog = console.log;
  console.log = (...parts: unknown[]) => {
    logged.push(parts.map(String).join(" "));
  };
  let speech: any = null;
  let heard: any = null;
  let aloud: any = null;
  try {
    speech = await synthesizeSentence(id, { text: "Hello there.", style: "", signal: new AbortController().signal, feature: "companion_speech" } as any);
    await drain(speech);
    heard = await transcribeWithGemini(id, CLIP);
    aloud = await synthesizeReadAloud(id, "Hello there.", new AbortController().signal);
  } catch (error) {
    wrong.push("a door threw: " + String((error as Error)?.message ?? error).split("\n")[0]);
  } finally {
    console.log = realLog;
  }
  await sleep(400);

  const labels: string[] = [];
  const sentenceFor = (feature: string, sentence: unknown, door: string) => {
    const match = OFF_SENTENCE.exec(String(sentence ?? ""));
    if (!match) {
      wrong.push(door + " answered the sentence " + JSON.stringify(String(sentence ?? "").slice(0, 100)) + ", not the switched-off sentence");
      return;
    }
    labels.push(match[1]);
    if (labelOf && match[1] !== labelOf(feature)) wrong.push(door + " named " + JSON.stringify(match[1]) + ", not the label " + JSON.stringify(labelOf(feature)));
  };
  if (speech?.ok !== false || speech?.reason !== "off") wrong.push("the speech door answered " + JSON.stringify({ ok: speech?.ok, reason: speech?.reason }) + ", not reason off");
  else sentenceFor("companion_speech", speech.sentence, "the speech door");
  if (heard?.ok !== false || heard?.reason !== "off") wrong.push("the transcribing door answered " + JSON.stringify({ ok: heard?.ok, reason: heard?.reason }) + ", not reason off");
  else sentenceFor("backup_transcription", heard.sentence, "the transcribing door");
  const offStatus = chatStatusForRefusal("off" as any);
  const noKeyStatus = chatStatusForRefusal("no_key" as any);
  if (offStatus !== noKeyStatus) wrong.push("chatStatusForRefusal gives off " + offStatus + " and no_key " + noKeyStatus);
  if (aloud?.ok !== false || aloud?.status !== noKeyStatus) {
    wrong.push("read-aloud answered " + JSON.stringify({ ok: aloud?.ok, status: aloud?.status, error: String(aloud?.error ?? "").slice(0, 80) }) + ", not the refusal status " + noKeyStatus);
  } else sentenceFor("read_aloud", aloud.error, "read-aloud");
  if (g.sent.length !== 0) wrong.push(g.sent.length + " request(s) reached Google's stand-in");
  const rows = g.rows(id);
  if (rows.length !== 0) wrong.push("gemini_calls_daily holds " + rows.length + " row(s) for asks that were switched off");
  const speechLines = logged.filter((line) => line.startsWith("[voice] gemini speech"));
  if (speechLines.length > 0) wrong.push("logged " + speechLines.length + " [voice] gemini speech line(s): " + speechLines[0].slice(0, 100));

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("all three doors answered off (" + labels.join(" / ") + "); read-aloud " + aloud.status + " as no_key is; 0 requests, 0 rows, no speech line");
});
