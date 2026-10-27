/**
 * How a Gemini call that did not succeed is read and worded, for the two doors that make one (`gemini-transcribe.ts`,
 * `gemini-speech.ts`): which statuses are worth a second ask, whether a refusal is the key's fault, Google's own
 * message, and the key's redaction. One home, so a transcription and a sentence of speech word a refused key the same way.
 */

/** The shape of a Google API key. Redacted from every sentence the voice module returns, whatever put it there. */
const KEY_SHAPE = /AIza[0-9A-Za-z_-]{20,}/g;

/** A busy or rate-limited Gemini often answers the second ask; any other status will not change in a second or two. */
const RETRY_STATUSES = new Set([429, 503]);
const REFUSED_STATUSES = new Set([401, 403]);

/** The part of Google's JSON error body the voice module reads: `{ error: { message } }`. Any Gemini reply type that carries `error` fits. */
export type GoogleErrorBody = { error?: { message?: unknown } };

/** Whether a status is one Gemini answers with "ask again shortly". Consumed by `gemini-transcribe.ts` and `gemini-speech.ts`, which each retry such an ask once. */
export function isRetryableStatus(status: number): boolean {
  return RETRY_STATUSES.has(status);
}

/** The sentence with the key (and anything shaped like one) replaced by `[key]`. Consumed by `gemini-transcribe.ts` and `gemini-speech.ts`, which pass every sentence they return through it. */
export function redactKey(sentence: string, key: string): string {
  return sentence.replaceAll(key, '[key]').replace(KEY_SHAPE, '[key]');
}

/** The text as a JSON object, or `null` when it is not one (an array, a string, a number, or not JSON at all). Consumed by `gemini-transcribe.ts` (the reply) and `gemini-speech.ts` (the stream's events). */
export function parseJsonObject<TObject extends object>(text: string): TObject | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as TObject) : null;
  } catch {
    return null;
  }
}

/**
 * Google's error body as `{ error: { message } }`: the object itself, or the one-element array that Gemini's streamed
 * endpoints wrap it in (`[{ "error": { … } }]`, which is what a refused key answers on the speech call). `null` for anything
 * else, which then reads as the bare start of the body. Consumed by `gemini-speech.ts`.
 */
export function parseGoogleError(text: string): GoogleErrorBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const body = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as GoogleErrorBody) : null;
}

/** Google's own message for a failed call, else the start of the raw body, else the bare status. Consumed by `gemini-transcribe.ts` and `gemini-speech.ts`. */
export function googleMessage(status: number, body: GoogleErrorBody | null, bodyText: string): string {
  const message = body?.error?.message;
  if (typeof message === 'string' && message.trim()) return message.trim();
  return bodyText.trim().slice(0, 300) || `HTTP ${status}`;
}

/** A 400 is the key's fault only when Google's error names the key (reason API_KEY_INVALID, or "API key not valid"); a 401 or 403 always is. Consumed by `gemini-transcribe.ts` and `gemini-speech.ts`. */
export function namesTheKey(status: number, body: GoogleErrorBody | null, bodyText: string): boolean {
  if (REFUSED_STATUSES.has(status)) return true;
  if (status !== 400) return false;
  return bodyText.includes('API_KEY_INVALID') || /api key/i.test(String(body?.error?.message ?? ''));
}

/** What a `fetch` that threw says: its message and, when undici gave one, the cause's (`fetch failed (connect ECONNREFUSED …)`). Consumed by `gemini-transcribe.ts` and `gemini-speech.ts`. */
export function describeFetchFailure(error: unknown): string {
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : '';
  return `${error instanceof Error ? error.message : String(error)}${cause}`;
}
