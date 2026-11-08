import type { VoiceAudioUpload } from '@/shared/types.js';

import { describeFetchFailure, parseJsonObject } from './gemini-errors.js';
import { cleanTranscript } from './transcript-cleanup.js';
import { whisperVocabularyPrompt } from './vocabulary-hints.js';
import { readVocabulary } from './vocabulary.js';
import { readVoiceSettings } from './voice-settings.js';

/**
 * Where this box's own speech-to-text service listens (`stt-local.service`: Parakeet hears, Qwen tidies). It speaks the OpenAI
 * transcription API, so the path below is OpenAI's. The address is per-box configuration (`STT_LOCAL_URL`); the default is the
 * loopback port the service binds. A box with no such service simply misses on every clip and hears through Gemini.
 */
const LOCAL_STT_BASE_URL = (process.env.STT_LOCAL_URL || 'http://127.0.0.1:8095/v1').replace(/\/$/, '');

/**
 * What a short clip may take on the service, hearing and tidying together (a 15 s clip takes about 3 s): the service gives its own
 * tidy pass up after 15 s, so this leaves 5 s over for hearing. Past the budget the clip goes to Gemini, so a wedged service costs the
 * person one wait of this length and never a dead mic. A longer clip gets more (`LOCAL_TIMEOUT_MS_PER_MB`).
 */
const LOCAL_BASE_TIMEOUT_MS = 20_000;

/**
 * What each megabyte of clip adds to the budget: the service's time to hear it, which follows the length of the audio. Measured on
 * the real service, 240 s of speech (946 KB of 32 kbps Opus) took 10.2 s to hear and 25 s in all with the tidy, which is capped at
 * 15 s however long the clip is; so the base plus this per megabyte covers all the service can take when it is healthy. With the
 * base alone, any dictation past about two minutes would run out of it, go to Gemini, and leave the service decoding a clip nobody
 * is waiting for. Bytes stand for length here, and Chrome's recorder writes about four times as many per second as that clip, which
 * only lengthens the wait.
 */
const LOCAL_TIMEOUT_MS_PER_MB = 12_000;

/** The longest the service is waited for whatever the size of the clip, so a wedged service costs a giant upload two minutes and no more. */
const LOCAL_MAX_TIMEOUT_MS = 120_000;

const BYTES_PER_MB = 1_000_000;

/** How much of a refused call's body a miss reason keeps for the log. */
const MISS_BODY_CHARS = 200;

/**
 * One clip's outcome from the local service: the words `heard`; `silent`, when the service answered and no words are left in what it
 * said (an empty answer, or a lone "Um." that the account's cleanup removes); or `missed`, with why it gave no answer at all. Neither of
 * the last two is an error for the person: the caller asks Gemini, and what it does with a Gemini that cannot answer differs between
 * them (`silent` keeps its empty answer). Consumed by `transcribe-speech.ts`, which logs `why`.
 */
export type LocalTranscript =
  | { kind: 'heard'; text: string }
  | { kind: 'silent' }
  | { kind: 'missed'; why: string };

/** What the service answered for a clip before the account's cleanup: its own `text` (which may be empty), or why the call gave none. */
type ServiceReply = { kind: 'text'; text: string } | { kind: 'missed'; why: string };

/**
 * Hears one clip on this box's own speech-to-text service, for one account. The clip goes with the account's vocabulary as the
 * `prompt` (the service's tidy pass respells sound-alikes to those names, as Whisper's prompt does) and with `clean` set from the
 * account's `cleanTranscripts` (off skips the tidy pass, so every um is kept). The text that comes back goes through the same
 * `cleanTranscript` the other transcribers use, once. It is `silent` when the service answers and no words are left after that, and
 * a miss, never a throw, when the service is down or slower than the clip's budget (`budgetMsFor`) or answers anything but a
 * transcript. Either way Gemini is then asked, as it was before this service existed. `model` is not sent; the service has one.
 * Consumed by `transcribe-speech.ts`, the one door for the chat mic and Kaylee's press.
 */
export async function transcribeLocally(userId: number, audio: VoiceAudioUpload): Promise<LocalTranscript> {
  const { cleanTranscripts } = readVoiceSettings(userId);
  const vocabulary = readVocabulary(userId);

  const reply = await askService(audio, whisperVocabularyPrompt(vocabulary), cleanTranscripts);
  if (reply.kind === 'missed') return reply;

  const text = cleanTranscript(reply.text, { removeFillers: cleanTranscripts, vocabulary });
  return text ? { kind: 'heard', text } : { kind: 'silent' };
}

/** The service's own `text` for the clip, before the account's cleanup, or why the call gave none. */
async function askService(audio: VoiceAudioUpload, vocabularyPrompt: string, tidy: boolean): Promise<ServiceReply> {
  const form = new FormData();
  form.append('file', new Blob([audio.bytes], { type: audio.mimeType }), audio.fileName);
  // Never sent empty, like the Whisper branch's.
  if (vocabularyPrompt) form.append('prompt', vocabularyPrompt);
  // "0" is the one value that skips the tidy pass.
  form.append('clean', tidy ? '1' : '0');

  const budgetMs = budgetMsFor(audio);
  let response: Response;
  let bodyText: string;
  try {
    response = await fetch(`${LOCAL_STT_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(budgetMs),
    });
    bodyText = await response.text();
  } catch (error) {
    return { kind: 'missed', why: describeFailure(error, budgetMs) };
  }

  if (!response.ok) return { kind: 'missed', why: `HTTP ${response.status}: ${oneLine(bodyText)}` };
  const text = parseJsonObject<{ text?: unknown }>(bodyText)?.text;
  return typeof text === 'string' ? { kind: 'text', text } : { kind: 'missed', why: 'the answer held no text' };
}

/** How long this clip may take on the service: the base wait and its megabytes' share, never past `LOCAL_MAX_TIMEOUT_MS`. A whole number of ms, which `AbortSignal.timeout` insists on. */
function budgetMsFor(audio: VoiceAudioUpload): number {
  const megabytes = audio.bytes.length / BYTES_PER_MB;
  return Math.min(LOCAL_MAX_TIMEOUT_MS, Math.ceil(LOCAL_BASE_TIMEOUT_MS + megabytes * LOCAL_TIMEOUT_MS_PER_MB));
}

/** What a failed `fetch` says for a miss: a timeout by the budget it ran out of, anything else by its message and cause. */
function describeFailure(error: unknown, budgetMs: number): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return `no answer within ${Math.round(budgetMs / 1000)} s`;
  }
  return describeFetchFailure(error);
}

/** The start of a body on one line, so a refusal never breaks the log line it is in. */
function oneLine(bodyText: string): string {
  return bodyText.replace(/\s+/g, ' ').trim().slice(0, MISS_BODY_CHARS);
}
