/**
 * The client's half of the JWT session: parsing, expiry, storage and the two
 * events the auth context listens to.
 *
 * Extracted from api.ts, which is meant to be the endpoint map plus its request
 * helpers. This is the security-sensitive part and it is what WebSocketContext,
 * AuthContext, the shell socket and the file-tree uploader actually import.
 */

import { recordAuthEvent } from '@/shared/authTrace';
import type { AuthTraceEvent } from '@/shared/types';

export const AUTH_TOKEN_REFRESHED_EVENT = 'auth-token-refreshed';
export const AUTH_SESSION_EXPIRED_EVENT = 'auth-session-expired';

/** The localStorage key of the shared session; read by AuthContext and the cross-tab follower, which must name the same key this file writes. */
export const AUTH_TOKEN_KEY = 'auth-token';

// Only accept a refreshed token that has this app's issued JWT shape
// (three base64url segments). An attacker-injected/malformed header value
// must never overwrite the stored auth token.
export const isValidRefreshedToken = (token: unknown): token is string =>
  typeof token === 'string' &&
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);

type TokenClaims = {
  issuedAt: number;
  expiresAt: number;
};

const readTokenClaims = (token: unknown): TokenClaims | null => {
  if (!isValidRefreshedToken(token)) {
    return null;
  }

  try {
    const encodedPayload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = encodedPayload.padEnd(
      encodedPayload.length + ((4 - (encodedPayload.length % 4)) % 4),
      '=',
    );
    const payload = JSON.parse(atob(paddedPayload)) as { iat?: unknown; exp?: unknown };

    if (
      typeof payload.iat !== 'number' ||
      !Number.isFinite(payload.iat) ||
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp)
    ) {
      return null;
    }

    return { issuedAt: payload.iat * 1000, expiresAt: payload.exp * 1000 };
  } catch {
    return null;
  }
};

// Tolerance for client/server clock skew. The server's own jwt.verify is the
// real authority; this check only decides whether the client should discard a
// token locally. Without an allowance, a browser clock running slightly ahead
// reads a still-server-valid token as expired and drops the session.
export const TOKEN_EXPIRY_SKEW_MS = 60_000;

export const isAuthTokenExpired = (token: unknown): boolean => {
  const claims = readTokenClaims(token);
  return claims ? Date.now() >= claims.expiresAt + TOKEN_EXPIRY_SKEW_MS : false;
};

export const getAuthTokenRefreshDelay = (token: unknown): number | null => {
  const claims = readTokenClaims(token);
  if (!claims) {
    return null;
  }

  const refreshAt = claims.issuedAt + ((claims.expiresAt - claims.issuedAt) / 2);
  return Math.max(0, refreshAt - Date.now());
};

const HOUR_MS = 3_600_000;

const hoursFromNow = (timeMs: number): number => Math.round(((timeMs - Date.now()) / HOUR_MS) * 10) / 10;

/** What a decision to end (or keep) a session was about, and what triggered it. */
type AuthEvidence = {
  /** Which code path is deciding, in words a journal line can carry (`request-verdict`, `websocket-token-expired`, ...). */
  trigger: string;
  /** The token the decision is about: the one the request carried or the one found expired; null when a request carried none. */
  token: string | null;
  url?: string;
  method?: string;
  status?: number;
  authError?: string | null;
};

const pathOnly = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return null;
  }
};

/**
 * Leaves one trace record for an auth decision. Used here and by AuthContext (logout, the boot
 * gate, another tab's change) so every way a session ends or is refused shows up in one place.
 */
export const traceAuthDecision = (evidence: AuthEvidence, outcome: AuthTraceEvent['outcome']): void => {
  const stored = localStorage.getItem(AUTH_TOKEN_KEY);
  const claims = readTokenClaims(evidence.token);
  recordAuthEvent({
    at: new Date().toISOString(),
    trigger: evidence.trigger,
    outcome,
    url: pathOnly(evidence.url),
    method: evidence.method ?? null,
    status: evidence.status ?? null,
    authError: evidence.authError ?? null,
    sent: evidence.token ? 'token' : 'none',
    stored: stored === null ? 'none' : stored === evidence.token ? 'same' : 'different',
    tokenAgeHours: claims ? hoursFromNow(claims.issuedAt) * -1 : null,
    tokenExpiresInHours: claims ? hoursFromNow(claims.expiresAt) : null,
    page: document.visibilityState === 'hidden' ? 'hidden' : 'visible',
    pageAgeMinutes: Math.round(performance.now() / 60_000),
    count: 1,
  });
};

/**
 * Ends the session — but only if `evidence.token` IS the session.
 *
 * localStorage holds ONE token for every tab and every request, while a verdict is always about a
 * particular token: the one a request carried, or the one a page remembered. Deleting the stored
 * token on any verdict let a stale one end a session it was never about — a request sent before
 * sign-in and answered after it, a background tab whose remembered token had aged out while another
 * tab held the refreshed one. Each surfaced to the person as a sign-out "out of nowhere".
 *
 * So the stored token is compared with the one the verdict is about. Same token (or both absent,
 * which is a page that still believes it is signed in after its storage went): the session is over.
 * A different one: the verdict is stale, the session stays, and the page is pointed at the newer
 * token it should have been using.
 *
 * The both-absent verdict is what every request a signed-out page still makes gets back, so it is
 * not recorded here — a record per stray 401 would bury the decision that signed the page out. It is
 * the ending of a session only for a page that HELD one (its storage emptied underneath it: eviction,
 * clear-site-data), and only that page's listener knows, so the evidence rides on the event and the
 * listener records it through `traceUnrecordedSignOut`.
 */
export const expireAuthSession = (evidence: AuthEvidence): void => {
  const stored = localStorage.getItem(AUTH_TOKEN_KEY);
  if (evidence.token !== stored) {
    traceAuthDecision(evidence, 'ignored');
    if (typeof window !== 'undefined' && stored && !isAuthTokenExpired(stored)) {
      window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT, { detail: stored }));
    }
    return;
  }

  const strayVerdict = evidence.token === null && stored === null;
  if (!strayVerdict) {
    traceAuthDecision(evidence, 'signed-out');
  }
  localStorage.removeItem(AUTH_TOKEN_KEY);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT, { detail: strayVerdict ? evidence : null }));
  }
};

/**
 * Used by AuthContext when a page that held a session hears it expired: records the verdict
 * `expireAuthSession` held back (a request that carried no token because storage had been emptied
 * under the page), so that sign-out names its request and status like every other.
 */
export const traceUnrecordedSignOut = (expiredEvent: Event): void => {
  const evidence = (expiredEvent as CustomEvent<AuthEvidence | null>).detail;
  if (evidence) {
    traceAuthDecision(evidence, 'signed-out');
  }
};

export const getStoredAuthToken = (): string | null => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (token && isAuthTokenExpired(token)) {
    expireAuthSession({ trigger: 'stored-token-expired', token });
    return null;
  }
  return token;
};

const writeStoredToken = (token: string): void => {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT, { detail: token }));
  }
};

/** Used by AuthContext when a sign-in or registration hands over a brand-new session, which replaces whatever was stored — a refresh must go through `storeAuthToken` instead. */
export const storeSignedInToken = (token: string): void => writeStoredToken(token);

/** Where a refreshed token came from, for the trace line if it is refused. */
type RefreshOrigin = { trigger: string; url?: string; method?: string; status?: number };

/**
 * Adopts a token the server sent back as a REFRESH of the session held now (the `X-Refreshed-Token`
 * header of any response, or the body of `/api/auth/refresh`). Returns whether it is now the stored one.
 * Used by api.ts (every response), the file-tree uploader (its XHR) and AuthContext (the refresh call).
 *
 * A refresh replaces a session; it never creates one and never turns one back. A token that arrives
 * is refused when
 *  - no session is stored: the response outlived a sign-out (logout, another tab, an expiry), and
 *    adopting it would sign the person back in;
 *  - it is already expired: no session ends up better for holding it;
 *  - it is not newer than the stored one. This is the case that ended sessions "out of nowhere": the
 *    browser's HTTP cache stores a response together with its `X-Refreshed-Token`, and answers every
 *    later revalidation of that URL that comes back 304 with the STORED header — a token from days
 *    ago, handed over as though the server had just minted it. Taking it moved the shared session
 *    backwards, and once that token was a week old the page read the session as expired and signed
 *    out. Responses that arrive out of order across tabs are the same shape.
 * Each refusal leaves an `ignored` trace record naming the request and the token's age.
 */
export const storeAuthToken = (token: unknown, origin: RefreshOrigin): boolean => {
  if (!isValidRefreshedToken(token)) {
    return false;
  }

  const stored = localStorage.getItem(AUTH_TOKEN_KEY);
  if (token === stored) {
    return true;
  }

  const refusal = ((): string | null => {
    if (stored === null) return 'no-session';
    if (isAuthTokenExpired(token)) return 'expired';
    const heldSince = readTokenClaims(stored)?.issuedAt;
    // A stored value that is not a readable token is junk, and any good token repairs it.
    return heldSince !== undefined && (readTokenClaims(token)?.issuedAt ?? 0) <= heldSince ? 'stale' : null;
  })();
  if (refusal) {
    traceAuthDecision({ ...origin, trigger: `${origin.trigger}-${refusal}`, token }, 'ignored');
    return false;
  }

  writeStoredToken(token);
  return true;
};
