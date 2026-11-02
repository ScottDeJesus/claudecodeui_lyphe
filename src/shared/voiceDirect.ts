/**
 * The browser-direct voice calls. The page may hold a base URL for the user's OWN OpenAI-compatible endpoint (`voiceConfig`,
 * per browser) and then hears a clip or speaks a sentence on it straight from the browser, a call the CloudCLI server never
 * sees. What the server does for its own paths (the account's vocabulary as Whisper's `prompt`, the cleanup of a transcript,
 * the respelling of a sentence for speech) is asked of its speech engine over three routes, so the page keeps no copy of that
 * matching: `GET /api/voice/transcribe-hints`, `POST /api/voice/clean` and `POST /api/voice/speakable`. Lives beside
 * `voiceConfig.ts` and never imports `api.ts`: the engine's three calls are handed in as `engine` (`api.voice`).
 */
import type { VoiceConfig } from '@/shared/voiceConfig';

/** The server speech engine's three calls this file makes, each sent with the signal it is handed; `api.voice` satisfies it. */
type VoiceEngine = {
  transcribeHints: (options: { signal: AbortSignal }) => Promise<Response>;
  clean: (text: string, options: { signal: AbortSignal }) => Promise<Response>;
  speakable: (text: string, options: { signal: AbortSignal }) => Promise<Response>;
};

/**
 * How long the page waits on the server's speech engine (hints, cleanup, respelling) before it goes on without it: these
 * calls only improve a transcript or a sentence, so a slow server never holds the mic or read-aloud up for the ordinary
 * 30 s request ceiling.
 */
const VOICE_ENGINE_TIMEOUT_MS = 5_000;

/** Builds a URL against the user's own OpenAI-compatible voice endpoint. */
function voiceDirectUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/**
 * Asks the server's speech engine for one text and answers `fallback` when it cannot, with a console warning: an unreachable
 * server, a refusal, an answer without the field or no answer within `VOICE_ENGINE_TIMEOUT_MS` costs the improvement, never
 * the dictation or the read-aloud. `call` is handed the signal to send its request with: this function's own, which the
 * timeout and the caller's `callerSignal` both abort. A call the caller aborted rethrows, since the caller no longer wants
 * what comes next.
 */
async function askVoiceEngine(
  what: string,
  call: (signal: AbortSignal) => Promise<Response>,
  field: 'prompt' | 'text',
  fallback: string,
  callerSignal?: AbortSignal,
): Promise<string> {
  // The caller's signal and the timeout are two reasons to stop one request. `AbortSignal.any` is absent on older WebKit
  // (iOS 15, which this app can be installed on), so the two are joined by hand.
  const controller = new AbortController();
  const abortWithCaller = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  callerSignal?.addEventListener('abort', abortWithCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), VOICE_ENGINE_TIMEOUT_MS);
  try {
    const response = await call(controller.signal);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const answer = (await response.json()) as Record<string, unknown> | null;
    const value = answer?.[field];
    if (typeof value !== 'string') throw new Error(`the answer held no ${field}`);
    return value;
  } catch (error) {
    // Only the CALLER's abort rethrows: this function's own timeout aborts a signal the caller never sees.
    if (callerSignal?.aborted) throw error;
    console.warn(`Voice ${what} unavailable, going on without it:`, error);
    return fallback;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortWithCaller);
  }
}

/**
 * Hears a clip on the browser's own endpoint with the account's vocabulary: its Whisper `prompt` (read per clip, so a word saved
 * in Settings applies on the next press with no reload) goes up with the clip, and the text that comes back passes through the
 * server's cleanup, the same one the proxy's own path runs. The answer is a `Response` of the same JSON shape the endpoint
 * answered with, `text` cleaned; a refusal, or an answer that is not `{ text }` with words in it, is handed back untouched.
 * Used by `transcribeVoice` in `src/shared/api.ts`, which the chat composer's mic (`useVoiceInput`) reads as a `Response`.
 */
export async function transcribeOnOwnEndpoint(blob: Blob, filename: string, config: VoiceConfig, engine: VoiceEngine): Promise<Response> {
  const prompt = await askVoiceEngine('transcription hints', (signal) => engine.transcribeHints({ signal }), 'prompt', '');

  const body = new FormData();
  body.append('file', blob, filename);
  body.append('model', config.sttModel || 'whisper-1');
  if (prompt) body.append('prompt', prompt);
  const response = await fetch(voiceDirectUrl(config.baseUrl.trim(), '/audio/transcriptions'), {
    method: 'POST',
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    body,
  });
  if (!response.ok) return response;

  // Read a copy, so a reply that is not the shape the composer reads is still handed back whole.
  const answer = (await response.clone().json().catch(() => null)) as { text?: unknown } | null;
  const heard = answer?.text;
  if (typeof heard !== 'string' || heard.trim() === '') return response;

  const text = await askVoiceEngine('transcript cleanup', (signal) => engine.clean(heard, { signal }), 'text', heard);
  return new Response(JSON.stringify({ ...answer, text }), {
    status: response.status,
    statusText: response.statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Speaks a sentence on the browser's own endpoint, the text respelled first by the server's engine so a house word is said as
 * the account's vocabulary says it, as the proxy's own path does. `signal` is the play's: aborting it stops the respelling and
 * the speech call alike. Used by `synthesizeVoice` in `src/shared/api.ts`, which the chat's read-aloud player (`voicePlayer`) calls.
 */
export async function synthesizeOnOwnEndpoint(text: string, config: VoiceConfig, signal: AbortSignal, engine: VoiceEngine): Promise<Response> {
  const input = await askVoiceEngine('respelling', (engineSignal) => engine.speakable(text, { signal: engineSignal }), 'text', text, signal);
  return fetch(voiceDirectUrl(config.baseUrl.trim(), '/audio/speech'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.ttsModel || 'tts-1',
      voice: config.ttsVoice || 'alloy',
      input,
      ...(config.ttsFormat.trim() ? { response_format: config.ttsFormat.trim() } : {}),
    }),
    signal,
  });
}
