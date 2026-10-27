import type { SpeechAnswer, SpeechChunk } from '@/shared/types.js';

import { describeFetchFailure, googleMessage, isRetryableStatus, namesTheKey, parseGoogleError, parseJsonObject, redactKey } from './gemini-errors.js';
import { resolveGeminiKey } from './gemini-key.js';
import { readVoiceSettings } from './voice-settings.js';

const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
/** The whole call, from the ask to the last byte. A sentence is at most 300 characters, so a stream still open after this is stuck. */
const CALL_TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 1_000;

/** A sentence whose message is already worded for the person and has passed the key redaction: thrown inside the stream, rethrown as it is. */
class WordedFailure extends Error {}

type Outcome = 'ok' | 'no_key' | 'refused' | 'failed' | 'aborted';

/**
 * One call's life: the request it can cancel, whether the caller or the clock ended it, the bytes it delivered, and the one
 * log line it owes. `end` writes that line the first time it is called and releases everything the call holds, so the first
 * outcome wins and a later one (an abort after the sentence finished) changes nothing.
 */
type Call = {
  /** Aborts when the caller's signal does, when the clock runs out, or when `end` is called. */
  readonly signal: AbortSignal;
  callerAborted(): boolean;
  timedOut(): boolean;
  addBytes(count: number): void;
  end(outcome: Outcome): void;
};

function beginCall(model: string, characters: number, callerSignal: AbortSignal): Call {
  const startedAt = Date.now();
  const request = new AbortController();
  let bytes = 0;
  let timedOut = false;
  let ended = false;

  const timer = setTimeout(() => {
    timedOut = true;
    request.abort();
  }, CALL_TIMEOUT_MS);

  const end = (outcome: Outcome): void => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    callerSignal.removeEventListener('abort', onCallerAbort);
    // Never the key: only the model, the sentence's length and what came of it.
    console.log(`[voice] gemini speech ${model} ${characters} ch ${bytes} B ${Date.now() - startedAt} ms → ${outcome}`);
    // The connection is released whatever state it is in; after a finished stream this is a no-op.
    request.abort();
  };
  // An abort stops the request at once, so nothing more is generated or spent, and the line is written then, not when the consumer next looks.
  function onCallerAbort(): void {
    end('aborted');
  }
  callerSignal.addEventListener('abort', onCallerAbort, { once: true });

  return {
    signal: request.signal,
    callerAborted: () => callerSignal.aborted,
    timedOut: () => timedOut,
    addBytes: (count) => {
      bytes += count;
    },
    end,
  };
}

/**
 * The Interactions API's single-speaker ask (https://ai.google.dev/gemini-api/docs/speech-generation): the sentence as the user
 * input with its delivery as a `speech_metadata` annotation, audio asked for as raw little-endian PCM, streamed.
 */
function speechRequestBody(model: string, voice: string, text: string, style: string): string {
  const annotations = style.trim() ? { annotations: [{ type: 'speech_metadata', style }] } : {};
  return JSON.stringify({
    model,
    input: [{ type: 'user_input', content: [{ type: 'text', text, ...annotations }] }],
    response_format: { type: 'audio', mime_type: 'audio/l16' },
    generation_config: { speech_config: [{ voice }] },
    stream: true,
  });
}

/** Waits `ms`, or less when `signal` aborts: whoever waits checks the signal after. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** How the ask opened: Google's answer to read, why none came, or that the caller no longer wants one. */
type Opening = { kind: 'response'; response: Response } | { kind: 'unreachable'; why: string } | { kind: 'aborted' };

/** The ask, retried once after one second when Gemini says it is busy (429) or unavailable (503) before it sends a byte of audio. */
async function openResponse(call: Call, key: string, body: string): Promise<Opening> {
  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(INTERACTIONS_URL, {
        method: 'POST',
        // The key rides this header and nowhere else: never the URL, a log line or an error sentence.
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body,
        signal: call.signal,
      });
    } catch (error) {
      if (call.callerAborted()) return { kind: 'aborted' };
      return { kind: 'unreachable', why: call.timedOut() ? `no answer within ${CALL_TIMEOUT_MS / 1000} s` : describeFetchFailure(error) };
    }
    if (attempt === 1 && isRetryableStatus(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      await pause(RETRY_DELAY_MS, call.signal);
      if (call.callerAborted()) return { kind: 'aborted' };
      continue;
    }
    return { kind: 'response', response };
  }
}

type Failure = Extract<SpeechAnswer, { ok: false }>;

/** The answer for a call Google refused or could not take (a non-2xx status), with its body read for Google's own message. `null` when the caller aborted meanwhile. */
async function refusalFrom(call: Call, response: Response, key: string): Promise<Failure | null> {
  let bodyText = '';
  try {
    bodyText = await response.text();
  } catch {
    // A body that cannot be read leaves the bare status to speak for it.
  }
  if (call.callerAborted()) return null;
  const reply = parseGoogleError(bodyText);
  const message = googleMessage(response.status, reply, bodyText);
  return namesTheKey(response.status, reply, bodyText)
    ? { ok: false, reason: 'refused', sentence: redactKey(`Gemini refused the key: ${message}`, key) }
    : { ok: false, reason: 'failed', sentence: redactKey(`Gemini could not speak this: HTTP ${response.status}: ${message}`, key) };
}

/** One server-sent event: its name (the `event:` line, else the data's own `event_type` or `type`) and its parsed data. */
type StreamEvent = { kind: string; data: { delta?: { type?: unknown; data?: unknown }; error?: { message?: unknown }; message?: unknown }; raw: string };

function parseEventBlock(block: string): StreamEvent | null {
  const lines = block.split(/\r?\n/);
  const named = lines.find((line) => line.startsWith('event:'))?.slice('event:'.length).trim();
  const raw = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).replace(/^ /, ''))
    .join('\n');
  if (!raw) return null;
  const data = parseJsonObject<StreamEvent['data'] & { event_type?: unknown; type?: unknown }>(raw);
  if (data === null) return null;
  const kind = named ?? (typeof data.event_type === 'string' ? data.event_type : typeof data.type === 'string' ? data.type : '');
  return { kind, data, raw };
}

/** The events of a server-sent-events body as they arrive; an event is closed by a blank line, however the bytes were chunked. */
async function* readEvents(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let pending = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    for (let boundary = /\r?\n\r?\n/.exec(pending); boundary !== null; boundary = /\r?\n\r?\n/.exec(pending)) {
      const block = pending.slice(0, boundary.index);
      pending = pending.slice(boundary.index + boundary[0].length);
      const event = parseEventBlock(block);
      if (event !== null) yield event;
    }
  }
  const last = parseEventBlock(pending + decoder.decode());
  if (last !== null) yield last;
}

/** Google's message in an `error` event, else the start of the event's data. */
function errorEventMessage(event: StreamEvent): string {
  const message = event.data.error?.message ?? event.data.message;
  return typeof message === 'string' && message.trim() ? message.trim() : event.raw.slice(0, 300);
}

/**
 * The sentence's audio as whole-sample pieces, in arrival order: the base64 PCM of every `step.delta` whose `delta.type` is
 * `audio`, until `interaction.completed`. An odd byte left at the end of a piece is half a sample and is carried into the next.
 * Ends quietly when the caller aborts; throws a `WordedFailure` for an `error` event, a stream that closes before
 * `interaction.completed` or holds no audio, and a request that dies. Writes the call's one log line however it ends.
 */
async function* audioPieces(call: Call, response: Response, key: string): AsyncGenerator<SpeechChunk> {
  const reader = response.body?.getReader();
  try {
    if (reader === undefined) throw new WordedFailure('Gemini could not speak this: the answer had no body');
    let carry: Uint8Array = new Uint8Array(0);
    let delivered = 0;
    let completed = false;
    for await (const event of readEvents(reader)) {
      if (event.kind === 'error') throw new WordedFailure(`Gemini could not speak this: Google reported an error: ${errorEventMessage(event)}`);
      if (event.kind === 'interaction.completed') {
        completed = true;
        break;
      }
      const delta = event.data.delta;
      if (event.kind !== 'step.delta' || delta?.type !== 'audio' || typeof delta.data !== 'string') continue;

      const joined = carry.length === 0 ? Buffer.from(delta.data, 'base64') : Buffer.concat([carry, Buffer.from(delta.data, 'base64')]);
      const whole = joined.length - (joined.length % 2);
      carry = joined.subarray(whole);
      if (whole === 0) continue;
      delivered += whole;
      call.addBytes(whole);
      yield joined.subarray(0, whole);
    }
    if (delivered === 0) throw new WordedFailure('Gemini could not speak this: the answer held no audio');
    if (!completed) throw new WordedFailure('Gemini could not speak this: the audio stopped before Google finished it');
    call.end('ok');
  } catch (error) {
    // The caller's own abort is the end it asked for, not a failure; the line was written when it fired.
    if (call.callerAborted()) return;
    call.end('failed');
    if (error instanceof WordedFailure) throw new WordedFailure(redactKey(error.message, key));
    throw new WordedFailure(redactKey(`Gemini could not speak this: ${call.timedOut() ? `no answer within ${CALL_TIMEOUT_MS / 1000} s` : describeFetchFailure(error)}`, key));
  } finally {
    // A consumer that stops early lands here too: the request is cancelled so nothing more is generated.
    call.end('aborted');
    await reader?.cancel().catch(() => undefined);
  }
}

/**
 * The first piece, then the rest, as an iterator written by hand rather than a generator: a generator's body (and its `finally`)
 * does not begin until its first `next()`, so a consumer that stopped or a caller that aborted BEFORE the first read would still
 * have been handed the first piece, and `return()` on the unread iterator would have left the request open until the 60 s bound
 * with no log line. Here an abort before the first read delivers nothing, and `return()` always ends the stream underneath
 * (which cancels the request and writes the call's line).
 */
function firstThenRest(call: Call, first: SpeechChunk, rest: AsyncGenerator<SpeechChunk>): AsyncIterable<SpeechChunk> {
  let unread: SpeechChunk | null = first;
  const iterator: AsyncIterator<SpeechChunk> = {
    async next() {
      if (unread === null) return rest.next();
      const piece = unread;
      unread = null;
      if (!call.callerAborted()) return { done: false, value: piece };
      await rest.return(undefined);
      return { done: true, value: undefined };
    },
    async return() {
      unread = null;
      await rest.return(undefined);
      return { done: true, value: undefined };
    },
  };
  return { [Symbol.asyncIterator]: () => iterator };
}

async function* nothing(): AsyncGenerator<SpeechChunk> {}

/**
 * One sentence spoken in the account's voice, through Gemini's Interactions API: the account's key (else the house's), its
 * speech model and its voice, streamed. `signal` ends it: the stream stops at once and the request is cancelled, so nothing
 * more is generated. The answer is given once the FIRST audio has arrived, so a refusal or a failure that comes before any
 * audio is an `ok: false` answer (`no_key`: no request made; `refused`: Google refused the key; `failed`: anything else, as a
 * sentence ready to show), and an `ok: true` answer is already speaking. A failure after audio began makes the iterator
 * throw an Error whose message is the sentence. A 429 or 503 before the first byte is asked again once after a second.
 * NOT COUNTED against any Gemini budget (the operator's ruling, 2026-10-26, "Kaylee doesn't count for the budget"): no
 * admit before, no record after. One log line per call, never the key.
 * Consumed through the voice barrel by the companion's speech door (`companion-speech.ts`).
 */
export async function synthesizeSentence(userId: number, input: { text: string; style: string; signal: AbortSignal }): Promise<SpeechAnswer> {
  const { speechModel, voice } = readVoiceSettings(userId).gemini;
  const call = beginCall(speechModel, input.text.length, input.signal);
  // An abort before the ask needs no ask: the listener was added too late to see it, so it is answered here.
  if (input.signal.aborted) {
    call.end('aborted');
    return { ok: true, chunks: nothing() };
  }

  const key = resolveGeminiKey(userId);
  if (!key) {
    call.end('no_key');
    return { ok: false, reason: 'no_key', sentence: 'No Gemini key: set one in Settings → Voice' };
  }

  const opening = await openResponse(call, key, speechRequestBody(speechModel, voice, input.text, input.style));
  if (opening.kind === 'aborted') return { ok: true, chunks: nothing() };
  if (opening.kind === 'unreachable') {
    call.end('failed');
    return { ok: false, reason: 'failed', sentence: redactKey(`Gemini could not speak this: ${opening.why}`, key) };
  }
  if (!opening.response.ok) {
    const refusal = await refusalFrom(call, opening.response, key);
    if (refusal === null) return { ok: true, chunks: nothing() };
    call.end(refusal.reason);
    return refusal;
  }

  const pieces = audioPieces(call, opening.response, key);
  try {
    const first = await pieces.next();
    // Done with no piece is only an abort: a stream that closes with no audio throws.
    return first.done ? { ok: true, chunks: nothing() } : { ok: true, chunks: firstThenRest(call, first.value, pieces) };
  } catch (error) {
    return { ok: false, reason: 'failed', sentence: error instanceof Error ? error.message : String(error) };
  }
}
