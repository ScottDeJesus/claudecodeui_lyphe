// gemini_wire.mjs — CloudCLI's wire to Google (server/modules/voice/gemini-wire.ts) and the voice doors that send through it,
// over a scratch database and a stand-in for Google, for cases/modules/.
//
//   import { wireGround, FAKE_KEY, KEY_TAIL, CLIP, pcmBytes, speechStream, transcriptReply, googleError, drain, sleep } from "../lib/gemini_wire.mjs";
//   const g = await wireGround(t, "label");     // meterGround's { folder, db, meter, missing } with a fake key in reach and fetch stood in
//   g.answer = (url, init) => new Response(...) // what Google's stand-in answers the next request with (it may throw, as a dead fetch does)
//   g.sent                                      // every request that reached the stand-in: { url, method, headers, body }
//   const rows = await g.counted(id, n);        // the account's gemini_calls_daily rows once they hold n calls (at most 3 s), else as they stand
//   const heard = await drain(answer);          // a SpeechAnswer's chunks read to the end: { chunks, bytes }
//
// NOTHING REAL IS OPENED OR SENT. The database is the case's scratch file. The key is a fake with a real key's shape, in
// reach through GEMINI_API_KEY and a scratch env file named by GEMINI_ENV_FILE, both put back when the case ends. fetch is
// replaced for the case's process: a request to Google's host reaches the stand-in, and any other request throws.

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { meterGround } from "./gemini_meter.mjs";

/** A fake key of a real key's shape (AIza and 35 more), valid nowhere. */
export const FAKE_KEY = "AIzaSyCaseFakeKeyNeverSentToGoogle0Wq7Z";
export const KEY_TAIL = FAKE_KEY.slice(-4);
/** One short clip for the transcribing door; the stand-in never listens to it. */
export const CLIP = { bytes: Buffer.alloc(3200), mimeType: "audio/wav", fileName: "clip.wav" };
const GOOGLE_HOST = "generativelanguage.googleapis.com";
const COUNT_WAIT_MS = 3000;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** n bytes of PCM, not silence. */
export const pcmBytes = (n) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 7) % 256));

/** The Interactions API's event stream for one sentence: the audio in deltas, then the terminal event, with usage or none. */
export function speechStream(pcm, usage, pieces = 2) {
  const size = Math.ceil(pcm.length / pieces);
  let text = "";
  for (let at = 0; at < pcm.length; at += size) {
    const delta = { event_type: "step.delta", delta: { type: "audio", data: pcm.subarray(at, at + size).toString("base64") } };
    text += "event: step.delta\ndata: " + JSON.stringify(delta) + "\n\n";
  }
  const done = { event_type: "interaction.completed" };
  if (usage) done.interaction = { usage };
  text += "event: interaction.completed\ndata: " + JSON.stringify(done) + "\n\n";
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** generateContent's JSON answer with the words heard, and usageMetadata when given. */
export function transcriptReply(words, usageMetadata) {
  const body = { candidates: [{ content: { role: "model", parts: [{ text: words }] }, finishReason: "STOP" }] };
  if (usageMetadata) body.usageMetadata = usageMetadata;
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=UTF-8" } });
}

/** Google's error body. */
export function googleError(status, message) {
  return new Response(JSON.stringify({ error: { code: status, message, status: "UNAVAILABLE" } }), { status, headers: { "content-type": "application/json; charset=UTF-8" } });
}

/** The bytes of audio one speech chunk carries, whatever field holds them. */
export function bytesOf(chunk) {
  if (chunk instanceof Uint8Array) return chunk.length;
  let n = 0;
  for (const value of Object.values(chunk ?? {})) {
    if (value instanceof Uint8Array) n += value.length;
    else if (typeof value === "string" && value.length >= 64 && /^[A-Za-z0-9+/=]+$/.test(value)) n += Buffer.from(value, "base64").length;
  }
  return n;
}

/** A SpeechAnswer's chunks read to the end. */
export async function drain(answer) {
  const heard = { chunks: 0, bytes: 0 };
  if (!answer || answer.ok !== true) return heard;
  for await (const chunk of answer.chunks) {
    heard.chunks += 1;
    heard.bytes += bytesOf(chunk);
  }
  return heard;
}

export async function wireGround(t, label) {
  const ground = await meterGround(t, label);
  const envFile = path.join(ground.folder, "gemini.env");
  await writeFile(envFile, "GEMINI_API_KEY=" + FAKE_KEY + "\n");
  const before = { key: process.env.GEMINI_API_KEY, file: process.env.GEMINI_ENV_FILE };
  process.env.GEMINI_API_KEY = FAKE_KEY;
  process.env.GEMINI_ENV_FILE = envFile;
  const realFetch = globalThis.fetch;
  const g = { ...ground, sent: [], answer: null };
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).hostname !== GOOGLE_HOST) throw new Error("the case lets no request leave the machine: " + url);
    g.sent.push({ url, method: init.method ?? "GET", headers: new Headers(init.headers), body: typeof init.body === "string" ? init.body : "" });
    if (typeof g.answer !== "function") throw new Error("the case set no answer for Google's stand-in");
    return g.answer(url, init);
  };
  t.defer(() => {
    globalThis.fetch = realFetch;
    for (const [name, value] of [["GEMINI_API_KEY", before.key], ["GEMINI_ENV_FILE", before.file]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  g.rows = (id) => {
    try {
      return ground.db.prepare("SELECT * FROM gemini_calls_daily WHERE user_id = ?").all(id);
    } catch {
      return [];
    }
  };
  g.counted = async (id, n) => {
    const until = Date.now() + COUNT_WAIT_MS;
    for (;;) {
      const rows = g.rows(id);
      const calls = rows.reduce((sum, row) => sum + Number(row.calls), 0);
      if (calls >= n || Date.now() > until) return rows;
      await sleep(50);
    }
  };
  return g;
}
