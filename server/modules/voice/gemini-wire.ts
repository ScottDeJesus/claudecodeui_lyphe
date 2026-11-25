import { geminiFeatureLabel, geminiFeatureOff, recordGeminiCall } from '@/modules/gemini-meter/index.js';
import type { GeminiFeature, GeminiUsage } from '@/modules/gemini-meter/index.js';

import { redactKey } from './gemini-errors.js';
import { geminiKeyId, resolveGeminiKey } from './gemini-key.js';
import { deliveredSpeechUsage, usageOf } from './gemini-usage-read.js';

/**
 * CloudCLI's wire to Google: the only sender of a request to Gemini and the only reader of the raw key outside
 * `gemini-key.ts`. Each ask reads the feature's switch (off: nothing sent, nothing counted), resolves the key (none:
 * nothing sent), sends one POST with the key in the `x-goog-api-key` header and nowhere else, and counts the request
 * on the account's Gemini meter once its answer has been read to the end or the request died. Never admitted, capped or
 * named to a Gemini budget (INV-9908): this counts, it does not ration. A retry is the door's second ask, so every attempt
 * is its own counted call.
 */

export type GeminiAsk = { userId: number; feature: GeminiFeature; model: string; url: string; body: string; signal: AbortSignal };

export type GeminiSent =
  | { kind: 'off'; sentence: string }
  | { kind: 'no_key' }
  | { kind: 'answer'; response: Response; redact(sentence: string): string };

const KEY_TAIL_LENGTH = 4;
/** The most of one answer the count keeps to read its usage from; a read-aloud piece's stream is about 3 MB. */
const COPY_LIMIT_BYTES = 16 * 1024 * 1024;
/** Statuses a Response may not be built with a body for: their answer is handed on as it came. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

type CountOutcome = { failed: boolean; usage: GeminiUsage | null; metered: boolean };
type CountCall = (outcome: CountOutcome) => void;

/**
 * Sends one ask and answers with Google's Response, whose body is one branch of the answer's stream: the caller reads it
 * exactly as it would have read the original, at the same moments, while the wire reads the other branch to count the
 * call. A fetch that throws (an abort, the clock, the network) is counted as a failure and thrown on. `redact` is the key
 * redaction every sentence built from this answer passes; the key itself never leaves this file.
 */
export async function askGemini(ask: GeminiAsk): Promise<GeminiSent> {
  if (geminiFeatureOff(ask.userId, ask.feature)) {
    return { kind: 'off', sentence: `Gemini is switched off for ${geminiFeatureLabel(ask.feature)}: turn it on in API → Gemini` };
  }
  const key = resolveGeminiKey(ask.userId);
  if (!key) return { kind: 'no_key' };

  const count: CountCall = ({ failed, usage, metered }) =>
    recordGeminiCall(ask.userId, { feature: ask.feature, model: ask.model, keyId: geminiKeyId(key), keyTail: key.slice(-KEY_TAIL_LENGTH), failed, usage, metered });

  let response: Response;
  try {
    response = await fetch(ask.url, {
      method: 'POST',
      // The key rides this header and nowhere else: never the URL, a log line, the count or an error sentence.
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: ask.body,
      signal: ask.signal,
    });
  } catch (error) {
    count({ failed: true, usage: null, metered: false });
    throw error;
  }

  const redact = (sentence: string): string => redactKey(sentence, key);
  if (response.body === null || NULL_BODY_STATUSES.has(response.status)) {
    countAnswer(ask, response, new Uint8Array(0), count);
    return { kind: 'answer', response, redact };
  }
  const [callerBranch, countBranch] = response.body.tee();
  void countWhenRead(ask, response, countBranch, count);
  return {
    kind: 'answer',
    response: new Response(callerBranch, { status: response.status, statusText: response.statusText, headers: response.headers }),
    redact,
  };
}

/** Reads the wire's branch to its end (or the request's death) and counts the call; a fault here is one warning, never a throw. */
async function countWhenRead(ask: GeminiAsk, response: Response, branch: ReadableStream<Uint8Array>, count: CountCall): Promise<void> {
  try {
    countAnswer(ask, response, await readCopy(branch), count);
  } catch (error) {
    console.warn(`[voice] a Gemini answer could not be counted (user ${ask.userId}, ${ask.feature}, ${ask.model}): ${error instanceof Error ? error.constructor.name : typeof error}`);
  }
}

/** The branch's bytes as far as they came; null when the answer outgrew the copy limit, so its usage is not read. */
async function readCopy(branch: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
  const reader = branch.getReader();
  const pieces: Uint8Array[] = [];
  let size = 0;
  let overflowed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (overflowed) continue;
      size += value.length;
      if (size > COPY_LIMIT_BYTES) {
        overflowed = true;
        pieces.length = 0;
        continue;
      }
      pieces.push(value);
    }
  } catch (error) {
    // The request died mid-answer (the caller's abort, the clock, the network): what arrived before it was still spent,
    // so it is counted from what came. Anything that is not the stream's own error is a defect and rises.
    if (!(error instanceof Error) && !(error instanceof DOMException)) throw error;
  }
  return overflowed ? null : Buffer.concat(pieces);
}

/**
 * The one count of an answered request: a non-2xx status is a failure; a 2xx with Google's usage is metered; a 2xx without
 * it is unmetered, its speech output derived from the audio it delivered (`deliveredSpeechUsage`), else no tokens.
 */
function countAnswer(ask: GeminiAsk, response: Response, copy: Uint8Array | null, count: CountCall): void {
  if (!response.ok) {
    count({ failed: true, usage: null, metered: false });
    return;
  }
  const read = copy === null ? { usage: null, audioBytes: 0 } : usageOf(response.headers.get('content-type') ?? '', copy);
  if (read.usage !== null) {
    count({ failed: false, usage: read.usage, metered: true });
    return;
  }
  count({ failed: false, usage: deliveredSpeechUsage(ask.model, read.audioBytes, new Date()), metered: false });
}
