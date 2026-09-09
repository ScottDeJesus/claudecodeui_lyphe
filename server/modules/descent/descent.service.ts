import type {
  DescentAccounts,
  DescentSlot,
  DescentUsage,
  DescentUsageWindow,
} from '@/shared/types.js';
import { createDescentTransport, readStringOrNull, type DescentServiceDependencies } from './descent.transport.js';

export { DescentUnreachable } from './descent.transport.js';

/** A finite number, or `null`. An absent or unreadable figure is never 0 here. */
function readNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
  const { readJson, writeJson } = createDescentTransport(dependencies);

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
