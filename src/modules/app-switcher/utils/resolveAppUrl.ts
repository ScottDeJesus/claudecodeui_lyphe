/**
 * The two rules that stand between a registry row and a frame: where the row points for THIS
 * reader, and whether the row is this application looking at itself.
 *
 * This file imports NOTHING, and that is load-bearing rather than tidy. Both functions are pure
 * and take everything they need as arguments — the host, the page origin, the port set — so they
 * can be run for real under `tsx`, outside a browser, with no test file. The moment either of them
 * read the page's address itself it would stop being provable, and the only proof left would be
 * somebody clicking through a UI.
 *
 * The caller passes the page's own hostname and origin, read at the open site — the drawer's rows,
 * the module's one reader of the page's address. The app already builds URLs from the page this way
 * (`src/modules/widgets/docspaceOrigin.ts`).
 */

/** `http://{host}:8004` + `10.0.0.5` -> `http://10.0.0.5:8004`. Case-insensitive. */
export function resolveAppUrl(url: string, host: string): string {
  // GLOBAL and case-insensitive, both deliberately. The hub's own rule was the same
  // (`seed.js:34`, `/\{host\}/gi`): a registry carrying `{HOST}` must resolve, and a URL naming
  // the placeholder twice must have both resolved. A non-global replace would leave the second
  // one in the src, which the browser reads as a host called `{host}`.
  return url.replace(/\{host\}/gi, host);
}

/**
 * True when the resolved url IS this app: the identical origin, or the same hostname on one of
 * the ports the app answers on itself (its API port or its Vite port).
 *
 * Such a row is opened in a new tab and NEVER framed. CloudCLI inside CloudCLI is a mirror, not
 * an application — and worse than a mirror, because the inner copy shares this page's
 * `localStorage['auth-token']` and would be showing its reader a session they did not ask for.
 *
 * ORIGINS FIRST, HOSTNAMES SECOND, and that order is not a shortcut. On this box the API answers
 * on `127.0.0.1:3011` while the browser sits on `127.0.0.1:5183` — one hostname, two origins — so
 * an origin-only test would frame the app whenever the tab was opened on its other port, and the
 * row it would frame is the `cloudcli` row. The port set is what closes that: it says which ports
 * belong to this app rather than which single origin the page happens to hold.
 *
 * A URL that will not parse returns FALSE — not self — because the two callers both read false as
 * "render it": the frame keeps its ordinary behaviour, which is what an address we cannot reason
 * about should get.
 *
 * THE DELIBERATE TWIN, and why it is not imported: `src/modules/widgets/docspaceOrigin.ts`
 * exports `isForeignOrigin(url)`, which is the negation of this predicate minus the port set. It
 * stays separate. That file is a chat-domain module, so a deep import into `@/modules/widgets` is
 * both a wrong-way coupling and a `boundaries/dependencies` error (`.oxlintrc.json`), and the two
 * questions genuinely differ: widgets asks origin-only because being conservative is the right
 * direction when the answer gates `allow-same-origin`, while the switcher needs the app's own port
 * set. This sentence is how the next reader finds both.
 */
export function isSelfOrigin(resolvedUrl: string, pageOrigin: string, selfPorts: number[]): boolean {
  let resolved: URL;
  let page: URL;
  try {
    resolved = new URL(resolvedUrl);
    page = new URL(pageOrigin);
  } catch {
    return false;
  }

  if (resolved.origin === page.origin) return true;
  if (resolved.hostname !== page.hostname) return false;

  return selfPorts.includes(portOf(resolved));
}

/**
 * A URL's port, defaulted from its scheme when the URL omits it.
 *
 * `URL.port` is the empty string for `http://myhost/x`, and an empty string is not a port: without
 * this, a row written without one falls out of every comparison against a numeric port set.
 */
function portOf(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}
