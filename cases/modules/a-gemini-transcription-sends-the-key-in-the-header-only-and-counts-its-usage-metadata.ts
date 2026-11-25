// protects: server/modules/voice/gemini-wire.ts, server/modules/voice/gemini-usage-read.ts, server/modules/voice/gemini-transcribe.ts, server/modules/voice/gemini-key.ts, server/modules/gemini-meter/gemini-meter.service.ts
// writes: none
//
// The key rides one header and the answer's usage is counted. On a scratch database with a fake key in reach and fetch
// stood in for Google, the transcribing door hears one clip whose stand-in answer carries usageMetadata: exactly one POST
// went out, the key in its x-goog-api-key header and in no URL, body or other header; one gemini_calls_daily row reads
// backup_transcription, the account's transcription model, the key's last four characters, calls 1, metered_calls 1,
// input = promptTokenCount, output = candidatesTokenCount + thoughtsTokenCount, input audio = the AUDIO entry of
// promptTokensDetails, and no column holds the key. Nothing reaches Google.

import { broken, held, runCase } from "../lib/case.mjs";
import { addUser } from "../lib/gemini_meter.mjs";
import { CLIP, FAKE_KEY, KEY_TAIL, transcriptReply, wireGround } from "../lib/gemini_wire.mjs";

const VOICE = "../../server/modules/voice";
const USAGE = {
  promptTokenCount: 120,
  candidatesTokenCount: 5,
  thoughtsTokenCount: 3,
  totalTokenCount: 128,
  promptTokensDetails: [{ modality: "TEXT", tokenCount: 20 }, { modality: "AUDIO", tokenCount: 100 }],
  candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 5 }],
};

runCase(async (t: any) => {
  const g: any = await wireGround(t, "gemini-wire-transcribe");
  if (!g.meter) return broken(g.missing);
  const { transcribeWithGemini } = await import(VOICE + "/gemini-transcribe.ts");
  const { readVoiceSettings } = await import(VOICE + "/voice-settings.ts");
  const id = addUser(g.db, "case-wire-transcribe");
  const model = readVoiceSettings(id).gemini.transcriptionModel;
  g.answer = () => transcriptReply("Hello there.", USAGE);
  const wrong: string[] = [];
  let heard: any = null;
  try {
    heard = await transcribeWithGemini(id, CLIP);
  } catch (error) {
    wrong.push("the door threw " + String((error as Error)?.message ?? error).split("\n")[0]);
  }
  if (heard && heard.ok !== true) wrong.push("the door answered " + JSON.stringify(heard).slice(0, 160) + ", not the words");
  if (g.sent.length !== 1) wrong.push(g.sent.length + " requests were sent, not 1");
  const sent = g.sent[0];
  if (sent) {
    if (sent.method !== "POST") wrong.push("the request was a " + sent.method + ", not a POST");
    if (sent.headers.get("x-goog-api-key") !== FAKE_KEY) wrong.push("the x-goog-api-key header does not carry the key");
    if (sent.url.includes(FAKE_KEY) || /[?&]key=/.test(sent.url)) wrong.push("the URL carries the key: " + sent.url.split(FAKE_KEY).join("<key>").slice(0, 120));
    if (sent.body.includes(FAKE_KEY)) wrong.push("the body carries the key");
    for (const [name, value] of sent.headers) {
      if (name !== "x-goog-api-key" && String(value).includes(FAKE_KEY)) wrong.push("the header " + name + " carries the key");
    }
  }
  const rows = await g.counted(id, 1);
  if (rows.length !== 1) wrong.push(rows.length + " gemini_calls_daily rows, not 1");
  const row = rows[0] ?? {};
  const want: Record<string, unknown> = {
    feature: "backup_transcription", model, key_tail: KEY_TAIL, calls: 1, failures: 0, metered_calls: 1,
    input_tokens: 120, output_tokens: 8, input_audio_tokens: 100, output_audio_tokens: 0,
  };
  if (rows.length === 1) {
    for (const [column, value] of Object.entries(want)) {
      if (row[column] !== value) wrong.push(column + " reads " + JSON.stringify(row[column]) + ", not " + JSON.stringify(value));
    }
    if (JSON.stringify(rows).includes(FAKE_KEY)) wrong.push("a gemini_calls_daily column holds the key");
    if (typeof row.key_id !== "string" || row.key_id.length === 0 || FAKE_KEY.includes(row.key_id)) wrong.push("key_id " + JSON.stringify(row.key_id) + " is not a digest of the key");
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("one POST, the key in x-goog-api-key alone; row backup_transcription " + model + " ..." + row.key_tail + " key_id " + row.key_id + ": calls 1, metered 1, tokens in 120 (audio 100) out 8");
});
