import net from 'node:net';

/**
 * CloudCLI's half of the Gemini budget relay: what this server hands on to shadow-connector as
 * `X-Gemini-Budget-Plan`, so a Gemini call a request starts there is counted against the right budget.
 *
 * THE NAMES AND THE RULE LIVE IN `/opt/shadow-connector/core/gemini_budget/attribution.py`. The header's
 * name, the word `production` and the off-box test are spelled here only because this server is TypeScript;
 * that file's docstring is their home, and a change to one is a change to both. The relay rule below is the
 * counterpart of its `current()`: the connector judges a request by what the last hop carried, so every hop
 * must carry the ID or say nothing, never guess.
 *
 *  - a client off this box is a person → `production`; whatever header it sent is ignored, because the
 *    budgets belong to this box's souls and a person must not be able to spend one by sending its name;
 *  - a client on this box with a clean header is a soul → that header, unchanged;
 *  - a client on this box with none → `null`, and nothing is carried. The connector then answers a request
 *    that reaches Gemini with its own refusal, which the sender can always fix.
 *
 * Node built-ins only, so both importers can load it: the Vite config (esbuild bundles it when Vite loads
 * the config, and `vite preview` reads the same one) and the server (run by tsx, where `@/` is `server/`).
 */

/**
 * The header a budget travels in. Consumers: `vite.config.js` (the `/api` proxy sets it) and the lane
 * forwarder and router in this directory (the forwarder sends it, the router reads the caller's).
 */
export const BUDGET_HEADER = 'X-Gemini-Budget-Plan';

/** The budget of work outside the caps: what a person off this box is always judged as. */
const PRODUCTION_BUDGET = 'production';

type ParsedAddress = { text: string; family: 'ipv4' | 'ipv6' };

/** `::ffff:a.b.c.d`, the form Node reports an IPv4 peer in on a dual-stack socket. */
const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** 127.0.0.0/8 and ::1: Node's `BlockList` reads `::ffff:7f00:1` and `0:0:0:0:0:0:0:1` as the same addresses. */
const LOOPBACK = new net.BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');

/** An address as text, `::ffff:` stripped and a zone id dropped; null for a missing or unparseable one. */
function parseAddress(raw: string | null | undefined): ParsedAddress | null {
  if (typeof raw !== 'string') return null;
  let text = raw.trim().split('%')[0];
  const mapped = MAPPED_IPV4.exec(text);
  if (mapped) text = mapped[1];
  const family = net.isIP(text);
  if (family === 4) return { text, family: 'ipv4' };
  if (family === 6) return { text, family: 'ipv6' };
  return null;
}

function sameAddress(first: ParsedAddress, second: ParsedAddress): boolean {
  if (first.family !== second.family) return false;
  const only = new net.BlockList();
  only.addAddress(first.text, first.family);
  return only.check(second.text, second.family);
}

/**
 * THE OFF-BOX TEST: is the client at `remoteAddress` not on this box? It is off the box when its address is
 * neither loopback nor equal to `localAddress`, the address it connected to — a process here that dials one of
 * the box's own addresses arrives from that same address. A missing or unparseable address (a unix socket)
 * counts as this box, on either side. Consumers: `relayBudget` below; exported because the design names the
 * test as part of this module's surface, so a probe can ask it alone.
 */
export function isOffBox(remoteAddress: string | null | undefined, localAddress: string | null | undefined): boolean {
  const remote = parseAddress(remoteAddress);
  if (remote === null || LOOPBACK.check(remote.text, remote.family)) return false;
  const local = parseAddress(localAddress);
  return local !== null && !sameAddress(remote, local);
}

/** The client's own header when it is usable: trimmed, not blank, and free of CR and LF. Else null. */
function carriedHeader(header: string | string[] | null | undefined): string | null {
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  return value !== undefined && value !== '' && !/[\r\n]/.test(value) ? value : null;
}

/**
 * The budget to carry on a hop to shadow-connector for one inbound request, or null to carry none. Its
 * addresses are the request's socket's (`remoteAddress`, `localAddress`) and `header` is the request's own
 * `X-Gemini-Budget-Plan`. Consumers: `vite.config.js` (the `/api` proxy of :5183 and :5184) and
 * `shadow-connector-lane-router.ts` (both lanes, so a caller that reaches the API's tailnet listener from off
 * the box is judged by the same rule).
 */
export function relayBudget({
  remoteAddress,
  localAddress,
  header,
}: {
  remoteAddress: string | null | undefined;
  localAddress: string | null | undefined;
  header: string | string[] | null | undefined;
}): string | null {
  if (isOffBox(remoteAddress, localAddress)) return PRODUCTION_BUDGET;
  return carriedHeader(header);
}
