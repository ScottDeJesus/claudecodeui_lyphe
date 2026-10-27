import type { TranscribeAnswer, VoiceAudioUpload } from '@/shared/types.js';

import { describeFetchFailure, googleMessage, isRetryableStatus, namesTheKey, parseJsonObject, redactKey } from './gemini-errors.js';
import { resolveGeminiKey } from './gemini-key.js';
import { readVoiceSettings } from './voice-settings.js';

const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const CALL_TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 2_000;

/**
 * What the model is told to answer for a clip with no words. "Output nothing" is an answer a model hardly ever gives: asked to
 * transcribe 2 s of digital silence it wrote a question nobody asked. A named mark is one it can give, and `readTranscript` reads it as
 * "no words".
 */
const NO_SPEECH_MARK = '[no speech]';

const TRANSCRIPTION_INSTRUCTION = 'Transcribe the speech in this audio verbatim, in the language it is spoken. '
  + 'Output only the words spoken, with no commentary, labels, timestamps or quotation marks. '
  + `If the audio holds no spoken words at all (silence, room noise, a click, breathing, music), output exactly ${NO_SPEECH_MARK} and nothing else. `
  + 'Never write words that were not spoken.';

/**
 * A whole answer that is one bracketed note — "[no speech]", "[silence]", "(inaudible)" — names what the clip held; it is not words
 * anyone said, so it is read as none. A transcript of speech never comes out as only that.
 */
const ANNOTATION_ONLY = /^(?:\[[^\]\n]{1,40}\]|\([^)\n]{1,40}\))\.?$/;

type GeminiReply = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> }; finishReason?: unknown }>;
  promptFeedback?: { blockReason?: unknown };
  error?: { message?: unknown; status?: unknown; details?: unknown };
};

/** One attempt's outcome, before it becomes a TranscribeAnswer: the status and body text, or why no answer came. */
type Attempt = { kind: 'answer'; status: number; bodyText: string } | { kind: 'unreachable'; why: string };

/** Gemini's audio guide accepts the recorder's own containers inline; the MIME is mapped by base type. */
function geminiMimeType(mimeType: string): string {
  const baseType = mimeType.split(';')[0].trim().toLowerCase();
  // Safari's recorder says audio/mp4 for AAC; Gemini names that container audio/m4a.
  return baseType === 'audio/mp4' ? 'audio/m4a' : baseType;
}

async function postOnce(url: string, key: string, body: string): Promise<Attempt> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      // The key rides this header and nowhere else: never the URL, a log line or an error sentence.
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    return { kind: 'answer', status: response.status, bodyText: await response.text() };
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return { kind: 'unreachable', why: `no answer within ${CALL_TIMEOUT_MS / 1000} s` };
    }
    return { kind: 'unreachable', why: describeFetchFailure(error) };
  }
}

/** The ask, retried once after two seconds when Gemini says it is busy (429) or unavailable (503). */
async function postWithRetry(url: string, key: string, body: string): Promise<Attempt> {
  const first = await postOnce(url, key, body);
  if (first.kind !== 'answer' || !isRetryableStatus(first.status)) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return postOnce(url, key, body);
}

/** Candidate 0's text, trimmed: a success even when empty (nothing said, or only a note saying so). Otherwise the sentence for a reply that holds no text. */
function readTranscript(reply: GeminiReply | null): { text: string } | { why: string } {
  const candidate = reply?.candidates?.[0];
  if (!candidate) {
    const blocked = reply?.promptFeedback?.blockReason;
    return { why: typeof blocked === 'string' ? `the request was blocked (${blocked})` : 'the answer held no candidate' };
  }

  const spoken = (candidate.content?.parts ?? [])
    .filter((part) => typeof part.text === 'string' && part.thought !== true)
    .map((part) => part.text as string)
    .join('');
  const words = spoken.trim();
  if (words || candidate.finishReason === 'STOP') {
    // A clip with no speech ends normally, either with the mark the instruction names or, from a model that obeys the old wording, with nothing at all.
    return { text: ANNOTATION_ONLY.test(words) ? '' : words };
  }
  return { why: `the answer held no text (finish reason ${String(candidate.finishReason ?? 'missing')})` };
}

function answerFrom(attempt: Attempt, key: string): TranscribeAnswer {
  if (attempt.kind === 'unreachable') {
    return { ok: false, reason: 'failed', sentence: redactKey(`Gemini could not transcribe this: ${attempt.why}`, key) };
  }

  const reply = parseJsonObject<GeminiReply>(attempt.bodyText);
  if (attempt.status < 200 || attempt.status >= 300) {
    const message = googleMessage(attempt.status, reply, attempt.bodyText);
    return namesTheKey(attempt.status, reply, attempt.bodyText)
      ? { ok: false, reason: 'refused', sentence: redactKey(`Gemini refused the key: ${message}`, key) }
      : { ok: false, reason: 'failed', sentence: redactKey(`Gemini could not transcribe this: HTTP ${attempt.status}: ${message}`, key) };
  }

  const transcript = readTranscript(reply);
  return 'text' in transcript
    ? { ok: true, text: transcript.text }
    : { ok: false, reason: 'failed', sentence: redactKey(`Gemini could not transcribe this: ${transcript.why}`, key) };
}

/**
 * Turns one clip into the words spoken, through Gemini, for one account: the account's key (else the house's) and
 * its transcription model, one `generateContent` call with `temperature: 0`. A clip with no words in it answers `ok` with
 * empty text (the model is told to say `[no speech]`, which is read as none). It never throws for an expected
 * failure; it answers `no_key` (no request made), `refused` (Google refused the key) or `failed` as a sentence
 * ready to show. NOT COUNTED against any Gemini budget (the operator's ruling): no admit before, no record after.
 * One log line per call, never the key.
 * Consumed by `voice-provider.ts` (the chat mic when the account's provider is Gemini) and, through the voice
 * barrel as `transcribeSpeech`, by the companion's press door (she always hears through Gemini).
 */
export async function transcribeWithGemini(userId: number, audio: VoiceAudioUpload): Promise<TranscribeAnswer> {
  const startedAt = Date.now();
  const model = readVoiceSettings(userId).gemini.transcriptionModel;
  const key = resolveGeminiKey(userId);

  let answer: TranscribeAnswer;
  if (!key) {
    answer = { ok: false, reason: 'no_key', sentence: 'No Gemini key: set one in Settings → Voice' };
  } else {
    const body = JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: TRANSCRIPTION_INSTRUCTION },
          { inline_data: { mime_type: geminiMimeType(audio.mimeType), data: audio.bytes.toString('base64') } },
        ],
      }],
      generationConfig: { temperature: 0 },
    });
    answer = answerFrom(await postWithRetry(`${GEMINI_MODELS_URL}/${encodeURIComponent(model)}:generateContent`, key, body), key);
  }

  const outcome = answer.ok ? 'ok' : answer.reason;
  console.log(`[voice] gemini transcribe ${model} ${audio.bytes.length} B ${Date.now() - startedAt} ms → ${outcome}`);
  return answer;
}
