import type {
  HomeServerTidy,
  VoiceRequestOverrides,
  VoiceService,
  VoiceServiceResult,
  VoiceSpeechPayload,
  VoiceTranscribeInput,
  VoiceTranscribeResult,
} from '@/shared/types.js';

import { type GoogleErrorBody, googleMessage, parseJsonObject } from './gemini-errors.js';

type VoiceServiceDependencies = {
  defaults: {
    baseUrl: string;
    apiKey: string;
    sttModel: string;
    ttsModel: string;
    ttsVoice: string;
  };
  timeoutMs: number;
  fetchBackend(url: string, options: RequestInit): Promise<Response>;
};

/** The speech call's settings: the environment defaults less the transcription model (a clip's endpoint is the account's own), with the request's format. */
type ResolvedVoiceConfig = Omit<VoiceServiceDependencies['defaults'], 'sttModel'> & {
  ttsFormat: string;
};

function resolveVoiceConfig(
  defaults: VoiceServiceDependencies['defaults'],
  overrides: VoiceRequestOverrides,
): ResolvedVoiceConfig {
  return {
    baseUrl: defaults.baseUrl,
    apiKey: overrides.apiKey || defaults.apiKey,
    ttsModel: overrides.ttsModel || defaults.ttsModel,
    ttsVoice: overrides.ttsVoice || defaults.ttsVoice,
    ttsFormat: overrides.ttsFormat?.trim() ?? '',
  };
}

/**
 * Whether a host (a URL's `hostname`, an IPv6 one in its brackets) is a link-local address, where clouds keep their instance
 * metadata: the IPv4 range 169.254.0.0/16 (the metadata address 169.254.169.254 among it), the same range written as an IPv4-mapped
 * IPv6 address (the URL parser spells `::ffff:169.254.169.254` as `::ffff:a9fe:a9fe`), the IPv6 link-local range fe80::/10, and AWS's
 * IPv6 metadata address fd00:ec2::254. Every other local or private host is allowed on purpose. Consumed by `validateBackendBaseUrl`
 * below and by `home-server-address.ts`, which names this reason when it refuses an address.
 */
export function isLinkLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host.startsWith('169.254.')
    || host.startsWith('::ffff:a9fe:')
    || /^fe[89ab][0-9a-f]:/.test(host)
    || host === 'fd00:ec2::254';
}

/**
 * Whether a base URL is one the server may call: http or https, and not a link-local address (`isLinkLocalHost`). Local and
 * private backends are allowed on purpose. Consumed by `home-server-address.ts`, which holds the account's saved address to the
 * same rule this client re-checks on every call.
 */
export function validateBackendBaseUrl(baseUrl: string): boolean {
  try {
    const parsedUrl = new URL(baseUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return false;
    }

    // Local and private backends are supported intentionally. Only link-local
    // addresses remain blocked as a defense in depth measure.
    return !isLinkLocalHost(parsedUrl.hostname);
  } catch {
    return false;
  }
}

function authorizationHeader(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function backendFailure(status: number, responseText?: string): VoiceServiceResult<never> {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      status: 502,
      error: 'Voice backend rejected the request (check the API key).',
    };
  }

  return {
    ok: false,
    status,
    error: responseText || 'voice backend error',
  };
}

function unreachableBackendFailure(error: unknown, timeoutMs: number): VoiceServiceResult<never> {
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      ok: false,
      status: 504,
      error: `Voice backend timed out after ${Math.round(timeoutMs / 1000)}s. Check your voice backend.`,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    status: 502,
    error: `Voice backend unreachable: ${message}`,
  };
}

function validateConfiguredBackend(config: ResolvedVoiceConfig): VoiceServiceResult<never> | null {
  if (!config.baseUrl) {
    return { ok: false, status: 503, error: 'No voice backend configured' };
  }

  if (!validateBackendBaseUrl(config.baseUrl)) {
    return { ok: false, status: 400, error: 'Invalid voice backend URL.' };
  }

  return null;
}

/**
 * The form of one transcription call, the fields the home server documents: `file`, `model` (the OpenAI protocol's; the box ignores it),
 * `clean` ("1" has the box clean the transcript up, "0" has it answer its raw words: the account's Clean transcripts switch) and, for an
 * account with a vocabulary, `prompt` (the house words as one line, "Word1, Word2, Word3.", for the box's cleanup to respell by).
 */
function createTranscriptionFormData(input: VoiceTranscribeInput, sttModel: string): FormData {
  const formData = new FormData();
  formData.append('file', new Blob([input.audio.bytes], { type: input.audio.mimeType }), input.audio.fileName);
  formData.append('model', sttModel);
  formData.append('clean', input.clean ? '1' : '0');
  if (input.vocabularyLine !== '') formData.append('prompt', input.vocabularyLine);
  return formData;
}

/**
 * The text with the key taken out, both as written and as a JSON body spells it (a box that echoes the header into an error body
 * escapes a `"` or a `\` in it). An empty key is left alone: replacing it would put the mark between every character.
 */
function withoutKey(text: string, apiKey: string): string {
  if (apiKey === '') return text;
  return text.replaceAll(apiKey, '[key]').replaceAll(JSON.stringify(apiKey).slice(1, -1), '[key]');
}

/** The longest stretch of the box's own words (an error message, a reason for its cleanup) that goes into a log line or a sentence. */
const MAX_BOX_WORDS_CHARS = 160;

/**
 * The box's own words as one short line: a run of white space (the real box answers an unreadable clip with three lines of ffmpeg
 * output) becomes one space and a long text is cut with an ellipsis, so they neither split a log line nor fill the person's sentence.
 */
function asOneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > MAX_BOX_WORDS_CHARS ? `${line.slice(0, MAX_BOX_WORDS_CHARS - 1)}…` : line;
}

/**
 * A non-2xx answer: 401 and 403 are the key refused; any other status (the box's 400 for no file or audio it cannot read, its 413 for a
 * clip over 50 MB) is a failure with the server's own message. That may echo what it was sent, so the key is taken out of the body BEFORE
 * any cut (a key straddling one would be left in part) and out of the message once more: the `detail` never holds the key.
 */
function transcriptionRefusal(status: number, bodyText: string, apiKey: string): VoiceTranscribeResult {
  if (status === 401 || status === 403) return { ok: false, kind: 'rejected', detail: `refused the key (HTTP ${status})` };
  const safeBody = withoutKey(bodyText, apiKey);
  const message = asOneLine(withoutKey(googleMessage(status, parseJsonObject<GoogleErrorBody>(safeBody), safeBody), apiKey));
  return { ok: false, kind: 'failed', detail: message === `HTTP ${status}` ? `answered HTTP ${status}` : `answered HTTP ${status}: ${message}` };
}

/** The box's `tidy` field when it is "raw (<why>)": the why. The real box says `raw (clean=0)`, `raw (tidy failed: TimeoutError)` and `raw (tidy rejected: 341 words heard, 120 returned)`. */
const RAW_TIDY_SHAPE = /^raw \((.*)\)$/s;

/**
 * The box's word on its cleanup (the `tidy` field): exactly "tidied" is the box having cleaned the text, anything else is not. "raw (<why>)"
 * gives its why; no `tidy`, or one that says something else, is read as not cleaned (the safe mistake: the house cleans text the box
 * already cleaned, never hands on text nobody cleaned). The reason is one line with the key out: it is the box's own words, bound for the log.
 */
function readTidy(tidy: unknown, apiKey: string): HomeServerTidy {
  if (tidy === 'tidied') return { tidied: true };
  const stated = typeof tidy === 'string' ? tidy.trim() : '';
  if (stated === '') return { tidied: false, reason: 'its answer did not say whether it tidied the text' };
  const reason = RAW_TIDY_SHAPE.exec(stated)?.[1] ?? stated;
  return { tidied: false, reason: asOneLine(withoutKey(reason, apiKey)) };
}

/** A 2xx answer's words: the JSON `text` field, empty for a clip with no speech, and the box's word on its cleanup of them. Anything else is not a transcript, so it is a failure rather than words to hand on. */
function readTranscript(bodyText: string, apiKey: string): VoiceTranscribeResult {
  const reply = parseJsonObject<{ text?: unknown; tidy?: unknown }>(bodyText);
  if (typeof reply?.text !== 'string') return { ok: false, kind: 'failed', detail: 'answered without a transcript' };
  return { ok: true, text: reply.text, tidy: readTidy(reply.tidy, apiKey) };
}

/** The shape of a Node error code (`ECONNREFUSED`): anything else (a message, a path, a newline) is never taken for one. */
const ERROR_CODE_SHAPE = /^[A-Z][A-Z0-9_]{1,59}$/;

/**
 * Plain words for why a connection failed, by the error code Node gives it, for the causes a person makes or can fix: a box that is
 * down, a mistyped host, a scheme or port that does not speak what the address says. The error's own message is never used: it
 * carries the host and port (the journal must not hold the address) and, for a TLS failure, OpenSSL's internals and a newline.
 */
const UNREACHABLE_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^ECONNREFUSED$/, 'the connection was refused'],
  [/^(?:ENOTFOUND|EAI_AGAIN)$/, 'the host name was not found'],
  [/^(?:ECONNRESET|EPIPE|UND_ERR_SOCKET)$/, 'the connection was reset'],
  [/^(?:ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|EHOSTUNREACH|ENETUNREACH)$/, 'the host did not answer the connection'],
  [/^(?:ERR_SSL_|ERR_TLS_|CERT_|DEPTH_ZERO_|SELF_SIGNED_|UNABLE_TO_)/, "the secure connection failed (is the address's https and port right?)"],
];

/** The code Node puts on a failed connection, read from the error or, for a failed `fetch`, from its cause; `''` when there is none in the shape a code has. */
function failureCode(error: unknown): string {
  for (const candidate of [error instanceof Error ? error.cause : undefined, error]) {
    if (typeof candidate === 'object' && candidate !== null && 'code' in candidate && typeof candidate.code === 'string' && ERROR_CODE_SHAPE.test(candidate.code)) {
      return candidate.code;
    }
  }
  return '';
}

/** A transcription call that got no answer: the wait ran out, or the request could not be made or the connection failed. */
function unansweredTranscription(error: unknown, waitMs: number): VoiceTranscribeResult {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return { ok: false, kind: 'timed_out', detail: `no answer within ${Math.round(waitMs / 1000)} s` };
  }
  const code = failureCode(error);
  const why = UNREACHABLE_WORDS.find(([pattern]) => pattern.test(code))?.[1] ?? (code === '' ? 'no connection could be made' : `connection error ${code}`);
  return { ok: false, kind: 'unreachable', detail: `could not be reached: ${why}` };
}

/**
 * Creates the OpenAI-compatible voice service for the Voice composition root
 * (`voice.module.ts`), which hands it to the try-then-backup transcriber, the provider decision
 * and the router. The outbound request function and server configuration are required so the
 * service never reads globals or creates production defaults.
 *
 * `transcribe` is the one OpenAI-compatible transcription client: it posts a clip to the endpoint it is handed (the account's home
 * server) with the account's key, the `clean` switch and the vocabulary line, under one wait for the whole exchange, and answers a value
 * (the words and the box's word on its cleanup of them), never a throw. `synthesizeSpeech` is read-aloud on the `openai` provider,
 * against the server's environment backend.
 */
export function createVoiceService(dependencies: VoiceServiceDependencies): VoiceService {
  return {
    getHealth: () => ({ configured: Boolean(dependencies.defaults.baseUrl) }),

    async transcribe(input) {
      const { baseUrl, apiKey, waitMs } = input;
      if (!validateBackendBaseUrl(baseUrl)) {
        return { ok: false, kind: 'failed', detail: 'its saved address is not one the server may call' };
      }

      try {
        const response = await dependencies.fetchBackend(
          `${baseUrl}/audio/transcriptions`,
          {
            method: 'POST',
            headers: authorizationHeader(apiKey),
            body: createTranscriptionFormData(input, dependencies.defaults.sttModel),
            // One bound for the whole exchange, the body read included: a box that sends its headers and then stalls is as unanswered as one that never connects.
            signal: AbortSignal.timeout(waitMs),
          },
        );
        const responseText = await response.text();
        return response.ok ? readTranscript(responseText, apiKey) : transcriptionRefusal(response.status, responseText, apiKey);
      } catch (error) {
        return unansweredTranscription(error, waitMs);
      }
    },

    async synthesizeSpeech(input) {
      const config = resolveVoiceConfig(dependencies.defaults, input.overrides);
      const configurationFailure = validateConfiguredBackend(config);
      if (configurationFailure) {
        return configurationFailure;
      }

      try {
        const response = await dependencies.fetchBackend(`${config.baseUrl}/audio/speech`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authorizationHeader(config.apiKey),
          },
          body: JSON.stringify({
            model: config.ttsModel,
            voice: config.ttsVoice,
            input: input.text,
            ...(config.ttsFormat ? { response_format: config.ttsFormat } : {}),
          }),
        });

        if (!response.ok) {
          const responseText = await response.text().catch(() => 'tts failed');
          return backendFailure(response.status, responseText);
        }

        const value: VoiceSpeechPayload = {
          contentType: response.headers.get('content-type') || 'audio/mpeg',
          body: response.body,
        };
        return { ok: true, value };
      } catch (error) {
        return unreachableBackendFailure(error, dependencies.timeoutMs);
      }
    },
  };
}
