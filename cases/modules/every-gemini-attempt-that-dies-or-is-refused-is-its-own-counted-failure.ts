// protects: server/modules/voice/gemini-wire.ts, server/modules/voice/gemini-speech.ts, server/modules/voice/gemini-transcribe.ts, server/modules/voice/gemini-errors.ts, server/modules/gemini-meter/gemini-meter.service.ts
// writes: none
//
// Every attempt is its own count, and a dead or refused one is a failure. On a scratch database with a fake key in reach
// and fetch stood in for Google: a transcription whose every fetch throws (the key quoted in the error), a speech ask
// whose every answer is 503 (the key quoted in the body), and a transcription answered 503 then a transcript with usage.
// For each account, gemini_calls_daily holds as many calls as the doors sent requests, every thrown or non-2xx attempt a
// failure and the answered one metered; no sentence a door returns holds the key. Nothing reaches Google.

import { broken, held, runCase } from "../lib/case.mjs";
import { addUser } from "../lib/gemini_meter.mjs";
import { CLIP, FAKE_KEY, drain, googleError, transcriptReply, wireGround } from "../lib/gemini_wire.mjs";

const VOICE = "../../server/modules/voice";
const USAGE = { promptTokenCount: 50, candidatesTokenCount: 4 };

runCase(async (t: any) => {
  const g: any = await wireGround(t, "gemini-wire-failures");
  if (!g.meter) return broken(g.missing);
  const { synthesizeSentence } = await import(VOICE + "/gemini-speech.ts");
  const { transcribeWithGemini } = await import(VOICE + "/gemini-transcribe.ts");
  const wrong: string[] = [];
  const said: string[] = [];

  const judge = async (id: number, sent: number, failures: number, metered: number, what: string) => {
    if (sent < 1) wrong.push(what + ": no request was sent");
    const rows = await g.counted(id, sent);
    const sum = (column: string) => rows.reduce((total: number, row: any) => total + Number(row[column] ?? 0), 0);
    const got = { calls: sum("calls"), failures: sum("failures"), metered_calls: sum("metered_calls") };
    const want = { calls: sent, failures, metered_calls: metered };
    if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(what + ": " + sent + " attempt(s) sent, counted " + JSON.stringify(got) + ", not " + JSON.stringify(want));
    said.push(what + " " + sent + "/" + got.calls + "/" + got.failures + "/" + got.metered_calls);
  };
  const keyIn = (answer: any, what: string) => {
    const words = String(answer?.sentence ?? answer?.threw ?? "");
    if (words.includes(FAKE_KEY)) wrong.push(what + ": the sentence quotes the key");
  };
  const caught = (error: any) => ({ threw: String(error?.message ?? error) });

  const thrown = addUser(g.db, "case-wire-thrown");
  let start = g.sent.length;
  g.answer = () => {
    throw new TypeError("fetch failed: socket hang up talking with " + FAKE_KEY);
  };
  const a: any = await transcribeWithGemini(thrown, CLIP).catch(caught);
  if (a?.ok !== false || a?.reason !== "failed") wrong.push("a dead fetch: the door answered " + JSON.stringify(a).slice(0, 120));
  keyIn(a, "a dead fetch");
  await judge(thrown, g.sent.length - start, g.sent.length - start, 0, "thrown");

  const refused = addUser(g.db, "case-wire-503");
  start = g.sent.length;
  g.answer = () => googleError(503, "The model is overloaded for key " + FAKE_KEY);
  const b: any = await synthesizeSentence(refused, { text: "Hello there.", style: "", signal: new AbortController().signal, feature: "companion_speech" } as any).catch(caught);
  await drain(b);
  if (b?.ok !== false) wrong.push("speech on 503: the door answered " + JSON.stringify(b).slice(0, 120));
  keyIn(b, "speech on 503");
  await judge(refused, g.sent.length - start, g.sent.length - start, 0, "speech-503");

  const retried = addUser(g.db, "case-wire-retry");
  start = g.sent.length;
  let attempts = 0;
  g.answer = () => {
    attempts += 1;
    return attempts === 1 ? googleError(503, "The model is overloaded") : transcriptReply("Hello there.", USAGE);
  };
  const c: any = await transcribeWithGemini(retried, CLIP).catch(caught);
  keyIn(c, "503 then answered");
  const sentC = g.sent.length - start;
  await judge(retried, sentC, 1, Math.max(0, sentC - 1), "retry");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("sent/calls/failures/metered: " + said.join("; ") + "; no sentence quoted the key");
});
