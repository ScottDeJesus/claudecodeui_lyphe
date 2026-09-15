import type { DeepseekBalance } from '@/shared/types.js';

/**
 * The vendor's own balance endpoint, absolute because it is not on this host and never will be.
 *
 * Deliberately a DEFAULT rather than the only source: the module passes the URL in as a
 * dependency, the way the Descent proxy passes its `baseUrl`, so a test can point this service at
 * a local port and prove all five unknown paths without touching the real account.
 */
export const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';

/**
 * One balance call's ceiling.
 *
 * The client re-reads on the usage cadence and on every panel open, so a vendor that has stopped
 * answering must cost one abandoned request, never a queue of them. Five seconds is far longer
 * than this endpoint takes when it answers at all (measured: ~0.3 s end to end through this route,
 * the vendor call being nearly all of it) and far shorter than the client's 30 s request ceiling,
 * so a hung call degrades to the calm unknown before the screen gives up on the whole request.
 */
export const DEEPSEEK_TIMEOUT_MS = 5000;

type DeepseekServiceDependencies = {
  balanceUrl: string;
  /**
   * The API key as it stands RIGHT NOW, or `null` when this host holds none.
   *
   * A function rather than a string, and awaited on every call, because the surface this serves
   * is exactly where someone pastes a key. The process environment is filled from `.env` once, at
   * boot (`server/load-env.ts`), so a key added to that file afterwards reaches this service only
   * through this per-call read — see `deepseek-key.ts` for the whole mechanism.
   */
  readApiKey: () => Promise<string | null>;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  now: () => number;
};

/** One entry of the vendor's `balance_infos`. Amounts arrive as decimal strings. */
type VendorBalanceInfo = { currency: string; total_balance: string };

/**
 * Whether one entry is something this app can draw: a currency to name it by, and an amount with
 * something IN it.
 *
 * Blank is what makes this strict rather than merely typed. `""` is a `string`, so a type check
 * alone calls it a reading — and an empty amount is not a balance of nothing any more than an
 * empty `balance_infos` is: `Number("")` is `0`, so it reaches the screen as a confident `$0.00`,
 * the one number this whole path exists to never invent. Same for a currency of spaces, which
 * would draw an amount with nothing naming it.
 */
function isReadableEntry(info: unknown): info is VendorBalanceInfo {
  if (!info || typeof info !== 'object') return false;

  const entry = info as Record<string, unknown>;
  return typeof entry.currency === 'string'
    && entry.currency.trim().length > 0
    && typeof entry.total_balance === 'string'
    && entry.total_balance.trim().length > 0;
}

/**
 * Reads the vendor's body into the one reading this app shows, or `null` when the body says
 * nothing this app can name.
 *
 * Strict on purpose, and strict about EVERY entry rather than filtering: `balance_infos` is a
 * whole answer, and one malformed row silently dropped could leave a CNY figure standing in for
 * the USD one. A shape this side cannot read is `bad-response`, which the screen draws as an
 * unknown — never as a balance of zero. A blank amount or a blank currency is one of those shapes,
 * not a reading (`isReadableEntry`): it is the one input that would otherwise reach the screen as a
 * hard `$0.00`.
 *
 * USD is preferred where the account holds more than one currency, and the first entry otherwise,
 * so a CNY-only account shows a CNY balance rather than nothing at all.
 */
function readVendorBalance(payload: unknown): { available: boolean; currency: string; total: string } | null {
  if (!payload || typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;
  if (typeof record.is_available !== 'boolean') return null;
  if (!Array.isArray(record.balance_infos)) return null;

  const infos = record.balance_infos;
  const readable = infos.every(isReadableEntry);
  if (!readable) return null;

  const chosen = infos.find((info) => info.currency === 'USD') ?? infos[0];
  // An empty list is NOT a balance of nothing: with no entry there is no currency and no amount,
  // so there is no reading at all, and the screen must draw an em-dash rather than `$0.00`.
  if (!chosen) return null;

  return { available: record.is_available, currency: chosen.currency, total: chosen.total_balance };
}

/**
 * The DeepSeek balance service.
 *
 * Used by `deepseek.routes.ts` for the account panel's balance line, which is the only consumer.
 * Every path — the five unknowns, and the reading itself — resolves to a `DeepseekBalance`; this
 * service never throws for a vendor that refused, timed out or answered oddly, because the route
 * above it answers 200 whatever happened and an em-dash is a fact while a 5xx is a wall.
 */
export function createDeepseekService(dependencies: DeepseekServiceDependencies): {
  balance(): Promise<DeepseekBalance>;
} {
  async function balance(): Promise<DeepseekBalance> {
    const apiKey = await dependencies.readApiKey();
    if (!apiKey) return { reachable: false, reason: 'unconfigured' };

    let response: Response;
    try {
      response = await dependencies.fetchImpl(dependencies.balanceUrl, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(dependencies.timeoutMs),
      });
    } catch (error) {
      // `AbortSignal.timeout` rejects with a `TimeoutError`; any other rejection is the socket —
      // DNS, a refused connection, TLS. The key is never in either message, and neither is
      // repeated outward: the reader is owed a word, not a stack.
      return {
        reachable: false,
        reason: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unreachable',
      };
    }

    // A refused key is its own word, because it is the one unknown the person reading this can
    // fix — and it is NOT `bad-response`: the vendor answered perfectly, and said no.
    if (response.status === 401 || response.status === 403) return { reachable: false, reason: 'auth' };
    if (!response.ok) return { reachable: false, reason: 'bad-response' };

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // A 200 carrying something that is not JSON. The body is dropped unread rather than
      // logged: on a refusal the vendor echoes part of the key back in its own error text.
      return { reachable: false, reason: 'bad-response' };
    }

    const reading = readVendorBalance(payload);
    if (!reading) return { reachable: false, reason: 'bad-response' };

    return {
      reachable: true,
      available: reading.available,
      currency: reading.currency,
      total: reading.total,
      checkedAt: dependencies.now(),
    };
  }

  return { balance };
}
