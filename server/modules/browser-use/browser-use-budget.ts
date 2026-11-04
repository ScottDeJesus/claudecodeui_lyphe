import net from 'node:net';
import os from 'node:os';

import { sendRequestWithBudget } from './browser-use-budget-follow.js';

// The header that carries a Gemini budget's ID. Its home is
// /opt/shadow-connector/core/gemini_budget/attribution.py (PLAN_HEADER), whose docstring states every name.
// Consumer: browser-use-mcp.routes.ts reads it off each MCP tool call.
export const GEMINI_BUDGET_HEADER = 'X-Gemini-Budget-Plan';

// The budget ID each agent session's browser carries, by session id. The session's own MCP process sent it with
// the latest tool call (null: that call brought none). An entry exists exactly while the session has a live
// context with its route installed, so a stopped or unknown session never accumulates one.
const budgetBySession = new Map<string, string | null>();

const IPV4_MAPPED_IPV6 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

// Writes an IP literal the way a WHATWG URL does, so a URL's host and an interface's address compare equal. An
// IPv4-mapped IPv6 address collapses to its IPv4 form. Returns null for anything that is not an IP literal.
function canonicalAddress(raw: string): string | null {
  const bare = raw.replace(/^\[|\]$/g, '');
  const family = net.isIP(bare);
  if (family === 0) {
    return null;
  }
  if (family === 4) {
    return bare;
  }
  let host: string;
  try {
    host = new URL(`http://[${bare}]/`).hostname.slice(1, -1);
  } catch (error) {
    console.warn('[Browser] Budget route could not read the IPv6 address', bare, error);
    return null;
  }
  const mapped = IPV4_MAPPED_IPV6.exec(host);
  if (!mapped) {
    return host;
  }
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

// "On this box" is loopback, or one of the box's own names and addresses: os.hostname() and the addresses of
// os.networkInterfaces(). A name that is neither localhost nor the hostname cannot be this box, so only an IP
// literal ever reads the interfaces.
function hostIsOnThisBox(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === os.hostname().toLowerCase()) {
    return true;
  }
  const address = canonicalAddress(host);
  if (address === null) {
    return false;
  }
  // The unspecified addresses reach this box on Linux, and scripts/curl counts 0.0.0.0 as this box too.
  if (address.startsWith('127.') || address === '::1' || address === '0.0.0.0' || address === '::') {
    return true;
  }
  return Object.values(os.networkInterfaces()).some((entries) => (
    (entries ?? []).some((entry) => canonicalAddress(entry.address) === address)
  ));
}

function urlIsOnThisBox(rawUrl: string): boolean {
  try {
    return hostIsOnThisBox(new URL(rawUrl).hostname);
  } catch {
    // A URL the browser sends but Node cannot parse names no host here; it goes out untouched.
    return false;
  }
}

// The request's headers for a hop bound for `url`: the page's own budget header never survives, and the
// session's ID is on the hop only when `url` is on this box.
function headersForHop(url: string, headers: Record<string, string>, budgetId: string): Record<string, string> {
  const edited: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== GEMINI_BUDGET_HEADER.toLowerCase()) {
      edited[name] = value;
    }
  }
  if (urlIsOnThisBox(url)) {
    edited[GEMINI_BUDGET_HEADER] = budgetId;
  }
  return edited;
}

// A stream is answered by Chromium itself: a buffered fetch would hold its first chunk until its last. Its
// request therefore goes out with the header added, and if its server redirects it, Playwright replays that
// header list onto the hop (see browser-use-budget-follow.ts). Measured: the apps this browser drives open
// their streams as EventSource.
function isStream(request: any): boolean {
  return request.resourceType() === 'eventsource' || /text\/event-stream/i.test(request.headers().accept ?? '');
}

// Called by browser-use.service.ts for every new agent context, both kinds (a persistent profile's and a
// temporary one's): one route that sends each request bound for this box with the session's budget ID, hop by
// hop (browser-use-budget-follow.ts), and lets every other request go out untouched. The ID is read at request
// time, so a later tool call's ID applies from that call on.
//
// KNOWN LIMITS (measured in real Chromium):
//   * a redirect's hop is a request Playwright does not route: the one a navigation makes, and any made by a
//     request to another host, goes out as Chromium sends it, with no ID, so a redirect INTO this box lands
//     without one; the next request the page makes is routed again;
//   * a stream's redirect hop carries the header, as above;
//   * a request other than a navigation that this box's server redirects resolves with the final response, so
//     the page's `response.url` and `redirected` read as if no redirect happened, and `redirect: 'manual'`
//     resolves `basic` and `redirect: 'error'` resolves with the final response;
//   * a response is fetched and then fulfilled, not a browser's own, so for any on-box request of a session with
//     an ID: a cross-origin response reaches the page without the CORS check (Playwright adds the permissive
//     headers to a fulfilled cross-origin response), the cookie jar answers whatever `credentials` or SameSite
//     said, a fetch that streams under an Accept other than text/event-stream reaches the page at its last
//     byte, a request the page abandons stays open at its server until the context closes, an
//     EventSource that the server redirects to another origin fails, and a form POST's chosen file loses its
//     bytes (no browser tool can choose one).
export async function installBudgetRoute(
  sessionId: string,
  context: { route: (url: string, handler: (route: any) => Promise<void>) => Promise<void> },
  budget: string | null,
): Promise<void> {
  budgetBySession.set(sessionId, budget);
  await context.route('**/*', async (route) => {
    const request = route.request();
    const budgetId = budgetBySession.get(sessionId) ?? null;
    try {
      if (!budgetId || !urlIsOnThisBox(request.url())) {
        await route.continue();
      } else if (isStream(request)) {
        await route.continue({ headers: headersForHop(request.url(), request.headers(), budgetId) });
      } else {
        await sendRequestWithBudget(route, (url, headers) => headersForHop(url, headers, budgetId));
      }
    } catch (error) {
      console.warn('[Browser] Budget route could not continue', request.url(), error);
      // The request must never hang on a failed edit; this second continue fails only when it is already gone.
      await route.continue().catch(() => undefined);
    }
  });
}

// Called by browser-use.service.ts on each agent tool call that names a session: the ID this call brought
// (null when it brought none) is the one the session's browser carries from now on. A session with no route
// installed is left alone.
export function rememberBudget(sessionId: string, budget: string | null | undefined): void {
  if (budget !== undefined && budgetBySession.has(sessionId)) {
    budgetBySession.set(sessionId, budget);
  }
}

// Called by browser-use.service.ts when a session's context closes.
export function forgetBudget(sessionId: string): void {
  budgetBySession.delete(sessionId);
}
