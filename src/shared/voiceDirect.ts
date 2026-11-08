/**
 * The browser-direct read-aloud call. The page may hold a base URL for the user's OWN OpenAI-compatible endpoint (`voiceConfig`,
 * per browser) and then speaks a sentence on it straight from the browser, a call the CloudCLI server never sees. What the server
 * does for its own speech path (the respelling of a sentence so a house word is said as the account's vocabulary says it) is asked
 * of its speech engine over one route, so the page keeps no copy of that matching: `POST /api/voice/speakable`. Transcription has no
 * browser-direct path: a clip goes to the server, which hears it on the account's home server with Gemini as the backup. Lives
 * beside `voiceConfig.ts` and never imports `api.ts`: the engine's call is handed in as `engine` (`api.voice`).
 */
import type { VoiceConfig } from '@/shared/voiceConfig';

/** The server speech engine's one call this file makes, sent with the signal it is handed; `api.voice` satisfies it. */
type VoiceEngine = {
  speakable: (text: string, options: { signal: AbortSignal }) => Promise<Response>;
};

/**
 * How long the page waits on the server's speech engine (the respelling) before it goes on without it: this call only improves a
 * sentence, so a slow server never holds the read-aloud up for the ordinary 30 s request ceiling.
 */
const VOICE_ENGINE_TIMEOUT_MS = 5_000;

/** Builds a URL against the user's own OpenAI-compatible voice endpoint. */
function voiceDirectUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/**
 * Asks the server's speech engine for the respelled text and answers `fallback` when it cannot, with a console warning: an
 * unreachable server, a refusal, an answer without `text` or no answer within `VOICE_ENGINE_TIMEOUT_MS` costs the improvement,
 * never the read-aloud. `call` is handed the signal to send its request with: this function's own, which the timeout and the
 * caller's `callerSignal` both abort. A call the caller aborted rethrows, since the caller no longer wants what comes next.
 */
async function askVoiceEngine(
  what: string,
  call: (signal: AbortSignal) => Promise<Response>,
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
    const value = answer?.text;
    if (typeof value !== 'string') throw new Error('the answer held no text');
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
 * Speaks a sentence on the browser's own endpoint, the text respelled first by the server's engine so a house word is said as
 * the account's vocabulary says it, as the proxy's own path does. `signal` is the play's: aborting it stops the respelling and
 * the speech call alike. Used by `synthesizeVoice` in `src/shared/api.ts`, which the chat's read-aloud player (`voicePlayer`) calls.
 */
export async function synthesizeOnOwnEndpoint(text: string, config: VoiceConfig, signal: AbortSignal, engine: VoiceEngine): Promise<Response> {
  const input = await askVoiceEngine('respelling', (engineSignal) => engine.speakable(text, { signal: engineSignal }), text, signal);
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
