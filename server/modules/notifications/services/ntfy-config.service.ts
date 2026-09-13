/**
 * The ntfy channel's settings, stored on the existing endpoints table.
 *
 * One row per user — channel `ntfy`, endpoint `default` — whose `enabled`
 * column is the channel's ONE on/off switch and whose metadata holds the
 * server URL, topic, access token and long-run threshold. The topic and token
 * are credentials: they leave this file unmasked only as an `NtfyConfig`,
 * which stays on the server; every client-bound shape is masked here.
 *
 * The tap-through URL (where a push opens CloudCLI) is instance-wide, not
 * per user, so it lives in `app_config`.
 */

import { appConfigDb, notificationChannelEndpointsDb } from '@/modules/database/index.js';

// Consumed by the notifications routes to recognise an ntfy row in the generic endpoints listing.
export const NTFY_CHANNEL = 'ntfy';
const NTFY_ENDPOINT_ID = 'default';
const DEFAULT_NTFY_SERVER = 'https://ntfy.sh';
const APP_URL_CONFIG_KEY = 'public_app_url';
const DEFAULT_LONG_RUN_MINUTES = 5;
const MAX_LONG_RUN_MINUTES = 1440;
const TOPIC_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Printable ASCII without spaces: anything else cannot ride an Authorization header. */
const TOKEN_PATTERN = /^[\x21-\x7E]{1,512}$/;
/** http(s), a host, and no whitespace anywhere. */
const HTTP_URL_PATTERN = /^https?:\/\/[^\s/?#]+\S*$/;

// Consumed by the ntfy channel and the notifications test route. Unmasked: never serialize it to a client.
export type NtfyConfig = {
  serverUrl: string;
  topic: string;
  token: string | null;
  longRunMinutes: number;
  enabled: boolean;
};

// Consumed by the notifications routes: the only shape of these settings a client ever sees.
export type NtfyConfigView = {
  configured: boolean;
  enabled: boolean;
  serverUrl: string;
  topicMasked: string | null;
  hasToken: boolean;
  longRunMinutes: number;
  appUrl: string | null;
};

// Consumed by the notifications routes, which parse `PUT /ntfy` into it. An absent field keeps the stored value.
export type NtfyConfigInput = {
  serverUrl?: string;
  topic?: string;
  /** `''` or `null` clears the stored token; absent keeps it. */
  token?: string | null;
  longRunMinutes?: number;
  enabled?: boolean;
};

// Consumed by the notifications routes: a 400 whose message is safe to show — it never quotes the topic or token.
export class NtfyConfigError extends Error {
  status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'NtfyConfigError';
  }
}

function readTrimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * A stored topic, but only one this file's own validation would have accepted.
 *
 * `POST /endpoints/current` can write any metadata for any channel, skipping
 * every check `PUT /ntfy` makes, so the READ path validates too: junk, or a
 * topic no longer of a legal shape, reads as no topic at all — which leaves the
 * channel disabled and the view unconfigured instead of publishing to it. The
 * server URL and access token beside it are read under their own patterns for
 * the same reason (`readServerUrl`, `readToken`).
 */
function readTopic(value: unknown): string {
  const topic = readTrimmed(value) ?? '';
  return TOPIC_PATTERN.test(topic) ? topic : '';
}

/** A stored server URL, or the default when the row holds one no save would have accepted. */
function readServerUrl(value: unknown): string {
  const serverUrl = readTrimmed(value) ?? '';
  return HTTP_URL_PATTERN.test(serverUrl) ? serverUrl : DEFAULT_NTFY_SERVER;
}

/** A stored access token, or none: a value that could not ride an Authorization header is not one. */
function readToken(value: unknown): string | null {
  const token = readTrimmed(value) ?? '';
  return TOKEN_PATTERN.test(token) ? token : null;
}

function readLongRunMinutes(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_LONG_RUN_MINUTES
    ? value as number
    : null;
}

/** Trims, strips trailing slashes, and refuses anything that is not an http(s) URL. */
function normalizeHttpUrl(value: string, field: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!HTTP_URL_PATTERN.test(normalized)) {
    throw new NtfyConfigError(`${field} must start with http:// or https://`);
  }
  return normalized;
}

function normalizeTopic(value: string): string {
  const topic = value.trim();
  if (topic && !TOPIC_PATTERN.test(topic)) {
    throw new NtfyConfigError('topic may hold only letters, digits, - and _ (1-64 characters)');
  }
  return topic;
}

function normalizeToken(value: string | null): string | null {
  const token = value?.trim() ?? '';
  if (!token) return null;
  if (!TOKEN_PATTERN.test(token)) {
    throw new NtfyConfigError('token must be printable characters without spaces');
  }
  return token;
}

function normalizeLongRunMinutes(value: number): number {
  const minutes = readLongRunMinutes(value);
  if (minutes === null) {
    throw new NtfyConfigError(`longRunMinutes must be a whole number from 0 to ${MAX_LONG_RUN_MINUTES}`);
  }
  return minutes;
}

function maskTopic(topic: string): string {
  return topic.length <= 4 ? '••••' : `${topic.slice(0, 2)}…${topic.slice(-2)}`;
}

/**
 * Reads a user's ntfy settings, or null when none are stored.
 *
 * Consumed by the ntfy channel (enablement and every send) and the
 * notifications routes. A row with no topic — or one of a shape this file would
 * not have stored — comes back with `topic: ''`, which the channel treats as not
 * configured.
 */
export function getNtfyConfig(userId: number): NtfyConfig | null {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const row = notificationChannelEndpointsDb.getEndpoint(userId, NTFY_CHANNEL, NTFY_ENDPOINT_ID);
  if (!row) return null;

  const metadata = notificationChannelEndpointsDb.parseMetadata(row.metadata_json);
  return {
    serverUrl: readServerUrl(metadata.serverUrl),
    topic: readTopic(metadata.topic),
    token: readToken(metadata.token),
    longRunMinutes: readLongRunMinutes(metadata.longRunMinutes) ?? DEFAULT_LONG_RUN_MINUTES,
    enabled: Boolean(row.enabled),
  };
}

/**
 * Validates and stores a user's ntfy settings, merging over what is stored.
 *
 * Consumed by the notifications routes' `PUT /ntfy`. An absent field keeps
 * its stored value — in particular an absent `token` keeps the stored token,
 * so a settings form that never shows the token cannot erase it. The first
 * save must carry a topic. Throws `NtfyConfigError` on invalid input.
 */
export function saveNtfyConfig(userId: number, input: NtfyConfigInput): NtfyConfigView {
  const stored = getNtfyConfig(userId);

  const topic = input.topic === undefined ? stored?.topic ?? '' : normalizeTopic(input.topic);
  if (!topic) throw new NtfyConfigError('topic required');

  const serverUrl = input.serverUrl === undefined
    ? stored?.serverUrl ?? DEFAULT_NTFY_SERVER
    : input.serverUrl.trim() ? normalizeHttpUrl(input.serverUrl, 'serverUrl') : DEFAULT_NTFY_SERVER;

  notificationChannelEndpointsDb.upsertEndpoint({
    userId,
    channel: NTFY_CHANNEL,
    endpointId: NTFY_ENDPOINT_ID,
    label: 'ntfy',
    metadata: {
      serverUrl,
      topic,
      token: input.token === undefined ? stored?.token ?? null : normalizeToken(input.token),
      longRunMinutes: input.longRunMinutes === undefined
        ? stored?.longRunMinutes ?? DEFAULT_LONG_RUN_MINUTES
        : normalizeLongRunMinutes(input.longRunMinutes),
    },
    enabled: input.enabled ?? stored?.enabled ?? true,
  });

  return toNtfyConfigView(getNtfyConfig(userId));
}

// Consumed by the notifications routes' `DELETE /ntfy`: forgets the user's ntfy settings entirely.
export function removeNtfyConfig(userId: number): void {
  notificationChannelEndpointsDb.removeEndpoint(userId, NTFY_CHANNEL, NTFY_ENDPOINT_ID);
}

// Consumed by the ntfy channel (tap-through links) and the notifications routes: where a push opens CloudCLI.
export function getAppUrl(): string | null {
  return appConfigDb.get(APP_URL_CONFIG_KEY) || null;
}

/**
 * The stored form of an app URL — normalized, or `''` for "forget it" — without writing it.
 * Consumed by the notifications routes, which validate a whole PUT before any half of it is
 * written, and by `setAppUrl`. Throws `NtfyConfigError` on a URL that is not http(s).
 */
export function normalizeAppUrl(url: string | null): string {
  return url && url.trim() ? normalizeHttpUrl(url, 'appUrl') : '';
}

// Consumed by the notifications routes' `PUT /ntfy`. `null` or `''` forgets the URL.
export function setAppUrl(url: string | null): void {
  appConfigDb.set(APP_URL_CONFIG_KEY, normalizeAppUrl(url));
}

/**
 * The client-safe view of a user's ntfy settings: the topic masked to its
 * first and last two characters, the token reduced to whether one exists.
 * Consumed by the notifications routes for every ntfy response.
 */
export function toNtfyConfigView(config: NtfyConfig | null): NtfyConfigView {
  return {
    configured: Boolean(config?.topic),
    enabled: Boolean(config?.enabled),
    serverUrl: config?.serverUrl ?? DEFAULT_NTFY_SERVER,
    topicMasked: config?.topic ? maskTopic(config.topic) : null,
    hasToken: Boolean(config?.token),
    longRunMinutes: config?.longRunMinutes ?? DEFAULT_LONG_RUN_MINUTES,
    appUrl: getAppUrl(),
  };
}

/**
 * Masks raw ntfy endpoint metadata for the generic endpoints listing, which
 * would otherwise return the topic and token verbatim. Consumed by the
 * notifications routes' `sanitizeEndpoint`. Reads the topic under the same
 * validation as `getNtfyConfig`, so metadata written around `PUT /ntfy` shows
 * as `topicMasked: null` rather than as a configured channel.
 */
export function maskNtfyMetadata(metadata: unknown): {
  serverUrl: string;
  topicMasked: string | null;
  hasToken: boolean;
  longRunMinutes: number;
} {
  const source = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
  const topic = readTopic(source.topic);
  return {
    serverUrl: readServerUrl(source.serverUrl),
    topicMasked: topic ? maskTopic(topic) : null,
    hasToken: Boolean(readToken(source.token)),
    longRunMinutes: readLongRunMinutes(source.longRunMinutes) ?? DEFAULT_LONG_RUN_MINUTES,
  };
}
