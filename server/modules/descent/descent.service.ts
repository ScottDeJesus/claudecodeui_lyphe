import type {
  DescentAccounts,
  DescentSlot,
  DescentUsage,
  DescentUsageWindow,
} from '@/shared/types.js';

/**
 * Why one Descent call could not be answered. These three words are the ONLY
 * thing this proxy ever says about a failure: never Descent's body, never a
 * stack, never a URL, never a filesystem path, never a token byte.
 */
type DescentFailureReason = 'unreachable' | 'timeout' | 'bad-response';

type DescentServiceDependencies = {
  /** Descent's origin, e.g. `http://127.0.0.1:7878`; a trailing slash is tolerated. */
  baseUrl: string;
  /** Injected so a probe can point the service at a closed port without touching the real one. */
  fetchImpl: typeof fetch;
  /** Wall-clock ceiling for one call. Must stay well under the client's poll interval. */
  timeoutMs: number;
};

/**
 * Thrown by the WRITE verbs (`switchAccount`, `capture`) when Descent never
 * answered, or answered with something that is not JSON — in either case there
 * is no status of Descent's to pass through. `descent.routes.ts` is the only
 * consumer: it turns this into a 503 carrying nothing but `reason`.
 *
 * Reads never throw. An unknown account picture is a calm 200
 * `{reachable:false, reason}` (Descent GOTCHAS #176), never a 5xx.
 */
export class DescentUnreachable extends Error {
  readonly reason: DescentFailureReason;

  constructor(reason: DescentFailureReason) {
    super(`Descent is not reachable (${reason})`);
    this.name = 'DescentUnreachable';
    this.reason = reason;
  }
}

/** A finite number, or `null`. An absent or unreadable figure is never 0 here. */
function readNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A non-empty string, or `null` — Descent itself sends `null` for a label it cannot read. */
function readStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Descent GOTCHAS #176: an un-provable flag is calm-FALSE, never a false alarm. */
function readFlag(value: unknown): boolean {
  return value === true;
}

/** A plain object, or `null` for anything else — arrays included. */
function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** The `name` of a thrown value without assuming it is an `Error` (undici throws DOMExceptions). */
function readThrownName(value: unknown): string {
  const named = value as { name?: unknown; cause?: unknown } | null;
  return typeof named?.name === 'string' ? named.name : '';
}

/**
 * Names a fetch failure in one word. A timeout is the abort our own
 * `AbortSignal.timeout` raised — undici surfaces it as a `TimeoutError`, either
 * directly or wrapped as the `cause` of a `TypeError: fetch failed`. Everything
 * else a socket can do (connection refused, DNS, reset) is `unreachable`.
 *
 * The signal covers the BODY as well as the headers, so a read that stalls
 * mid-stream aborts here too — hence `fallback`, which lets the body-reading
 * catch keep `bad-response` for a genuine parse failure while still naming a
 * timeout a timeout.
 */
function classifyFetchFailure(
  error: unknown,
  fallback: DescentFailureReason = 'unreachable',
): DescentFailureReason {
  const cause = (error as { cause?: unknown } | null)?.cause;
  return readThrownName(error) === 'TimeoutError' || readThrownName(cause) === 'TimeoutError'
    ? 'timeout'
    : fallback;
}

/**
 * Descent's `{ok:true, accounts:{…}}` body → the camelCased contract, or `null`
 * when there is no account picture in it (the caller answers `bad-response`).
 *
 * `ok` is tested rather than trusted: Descent's own `ok()` helper always sets it
 * true today and its error envelope carries no `accounts` key at all, so this
 * gate is redundant against the Descent that exists — and is exactly what stops
 * a future `{ok:false, accounts:{…}}` being served as a healthy picture.
 *
 * A slot with no slug fails the WHOLE read rather than being skipped. Dropping
 * it would hide an entire account from the switcher with nothing said, and a
 * hidden account is worse than a blank panel: the operator can act on "Descent
 * is not reachable" and cannot act on a row that was never drawn. The slug is
 * also the only handle a switch has, so a slot without one is unusable anyway.
 */
function toAccounts(payload: unknown): DescentAccounts | null {
  const envelope = readRecord(payload);
  if (envelope?.ok !== true) return null;

  const accounts = readRecord(envelope.accounts);
  if (!accounts || !Array.isArray(accounts.slots)) return null;

  const slots: DescentSlot[] = [];
  for (const entry of accounts.slots) {
    const slot = readRecord(entry);
    const slug = readStringOrNull(slot?.slug);
    if (!slot || slug === null) return null;
    slots.push({
      slug,
      label: readStringOrNull(slot.label) ?? slug,
      expiresAt: readNumberOrNull(slot.expires_at),
      isActive: readFlag(slot.is_active),
    });
  }

  return {
    reachable: true,
    active: readStringOrNull(accounts.active),
    activeLabel: readStringOrNull(accounts.active_label),
    slots,
    liveLabel: readStringOrNull(accounts.live_label),
    liveExpiresAt: readNumberOrNull(accounts.live_expires_at),
    drift: readFlag(accounts.drift),
    // A count the row states, never a gate (Descent GOTCHAS #174). Unproven
    // reads as "none proven running", which understates rather than blocks.
    liveSessions: readNumberOrNull(accounts.live_sessions) ?? 0,
    unreadable: readFlag(accounts.unreadable),
  };
}

/**
 * Descent's `{ok:true, usage:{…}}` body → the camelCased contract, or `null`
 * when it carries no window list or no `checked_at` — a reading with no time on
 * it is not a reading. `percent` and `resets_at` stay `null` when Descent has
 * none: an unknown figure must never arrive at the client as 0 %.
 *
 * An EMPTY `windows` list is a real answer, not a failure: Descent sends it
 * while a poll is in flight (`reason:'pending'`) and when a credential move
 * left it with no figures under this account (`degraded:true`). Both reach the
 * client as `reachable:true` with the reason intact, so the panel can say which.
 *
 * ⚠ This mapper names every key it forwards, so a field Descent ADDS is dropped
 * silently — which is how `severity` was nearly lost. Anything new in Descent's
 * window rows has to be added here AND to `DescentUsageWindow`.
 */
function toUsage(payload: unknown): DescentUsage | null {
  const envelope = readRecord(payload);
  if (envelope?.ok !== true) return null;

  const usage = readRecord(envelope.usage);
  const checkedAt = readNumberOrNull(usage?.checked_at);
  if (!usage || !Array.isArray(usage.windows) || checkedAt === null) return null;

  const windows: DescentUsageWindow[] = [];
  for (const entry of usage.windows) {
    const window = readRecord(entry);
    const key = readStringOrNull(window?.key);
    if (!window || key === null) return null;
    const severity = readStringOrNull(window.severity);
    windows.push({
      key,
      label: readStringOrNull(window.label) ?? key,
      percent: readNumberOrNull(window.percent),
      resetsAt: readStringOrNull(window.resets_at),
      // Both are present only when Descent said so, so `in` stays a fact rather
      // than a default. `severity` is the vendor's own alarm and Descent has
      // already filtered the benign words out, so its mere PRESENCE is the
      // signal — a flagged window can read a comfortable 12 % and still mean an
      // account lock, which is the one thing a percentage cannot say.
      ...(typeof window.rolled === 'boolean' ? { rolled: window.rolled } : {}),
      ...(severity === null ? {} : { severity }),
    });
  }

  return {
    reachable: true,
    windows,
    degraded: readFlag(usage.degraded),
    // `''` is Descent's OWN word for "healthy, nothing to say", so an absent key
    // deliberately reads as that rather than as a null the client must branch on.
    reason: readStringOrNull(usage.reason) ?? '',
    staleSince: readNumberOrNull(usage.stale_since),
    checkedAt,
  };
}

/**
 * Builds the Descent proxy used by `descent.module.ts` and by the down-path
 * probe, which constructs it against a closed port.
 *
 * Nothing here caches: Descent already does, and a second cache would age its
 * figures a second time. Nothing here opens a credential file either — the
 * whole account picture arrives over HTTP, and token bytes never enter this
 * process (Descent GOTCHAS #172).
 */
export function createDescentService(dependencies: DescentServiceDependencies) {
  const origin = dependencies.baseUrl.replace(/\/$/, '');

  /**
   * GETs one Descent path. A non-2xx is NOT special-cased: such a body fails the
   * mapper's `ok` gate and carries no `accounts`/`usage` key either, so the
   * caller says `bad-response` — one path for "Descent answered with no picture".
   */
  async function readJson(path: string): Promise<{ body: unknown } | { failure: DescentFailureReason }> {
    let response: Response;
    try {
      response = await dependencies.fetchImpl(`${origin}${path}`, {
        signal: AbortSignal.timeout(dependencies.timeoutMs),
      });
    } catch (error) {
      return { failure: classifyFetchFailure(error) };
    }

    try {
      return { body: await response.json() };
    } catch (error) {
      // Headers arrived, so this is a body that could not be read — a parse
      // failure, or the timeout firing while the body was still streaming.
      return { failure: classifyFetchFailure(error, 'bad-response') };
    }
  }

  /** POSTs one Descent path and hands back Descent's OWN status and body, untouched. */
  async function writeJson(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await dependencies.fetchImpl(`${origin}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(dependencies.timeoutMs),
      });
    } catch (error) {
      throw new DescentUnreachable(classifyFetchFailure(error));
    }

    try {
      return { status: response.status, body: await response.json() };
    } catch (error) {
      // Descent answered, but with no JSON body to pass through — there is
      // nothing to forward, so this is a failure to reach it, not its verdict.
      throw new DescentUnreachable(classifyFetchFailure(error, 'bad-response'));
    }
  }

  return {
    /** The account picture, or the calm one-word reason it is unknown. Never throws. */
    async accounts(): Promise<DescentAccounts> {
      const result = await readJson('/api/accounts');
      if ('failure' in result) return { reachable: false, reason: result.failure };
      return toAccounts(result.body) ?? { reachable: false, reason: 'bad-response' };
    },

    /** The usage windows as Descent last measured them. Never throws. */
    async usage(): Promise<DescentUsage> {
      const result = await readJson('/api/usage');
      if ('failure' in result) return { reachable: false, reason: result.failure };
      return toUsage(result.body) ?? { reachable: false, reason: 'bad-response' };
    },

    /** Asks Descent to make `slug` the active account. Throws `DescentUnreachable` when it cannot ask. */
    switchAccount(slug: string): Promise<{ status: number; body: unknown }> {
      return writeJson('/api/accounts/switch', { slug });
    },

    /** Asks Descent to save the live login into its own slot. Throws `DescentUnreachable` when it cannot ask. */
    capture(): Promise<{ status: number; body: unknown }> {
      return writeJson('/api/accounts/capture', {});
    },
  };
}
