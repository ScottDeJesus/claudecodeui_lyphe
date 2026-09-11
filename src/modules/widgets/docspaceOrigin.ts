import type { DocSpaceBlockRef } from '@/shared/types';

/**
 * Where a DocSpace block is embedded FROM, and the one rule that makes embedding it safe.
 *
 * WHY THE ORIGIN MUST NOT BE THIS APP'S. The DocSpace frame is not the HTML widget's sibling. An
 * HTML widget is model output, so it goes into an opaque-origin `srcDoc` frame with nothing of
 * ours inside it. A DocSpace block is a real page served by ArchPulse, with its own document, its
 * own stylesheet and its own API to write the operator's edit back through — so its frame carries
 * `allow-same-origin` and keeps a real origin, because a block that cannot reach its own server
 * cannot be edited, which is the entire point of embedding it.
 *
 * `allow-same-origin` grants the frame the origin of the DOCUMENT IT LOADS. That is harmless
 * while the document is ArchPulse's, and it is a hole the moment the document is CloudCLI's:
 * CloudCLI's login JWT sits in `localStorage['auth-token']` (`src/shared/authToken.ts`), and a
 * same-origin frame reads it as easily as the page does. So the invariant is not "a particular
 * host is trusted" but "the frame's origin is NOT ours", and `isForeignOrigin` is where that is
 * enforced — mechanically, before the iframe is ever rendered, whatever the operator put in
 * `VITE_DOCSPACE_EMBED_ORIGIN`. It is the reason this app must never proxy port 8005 through its
 * own Express or Vite to "reach the phone": that would make the frame same-origin and hand it the
 * token. The phone already reaches ArchPulse directly over Tailscale, which is what the default
 * below resolves to.
 */

/** ArchPulse's port. The default origin is derived rather than configured, so the LAN and Tailscale both work unset. */
export const DOCSPACE_EMBED_DEFAULT_PORT = 8005;

/**
 * The origin CloudCLI embeds DocSpace blocks from.
 *
 * Unset — the ordinary case — this is the page's OWN hostname on ArchPulse's port, which is right
 * whether the tab was opened on localhost, on the LAN address or through the Tailscale name: the
 * two services live on the same box, so whatever name reached this page reaches that one. The
 * env var exists for the case the default cannot cover, ArchPulse on another host.
 *
 * The `import.meta.env?.…` read is the app's own idiom (`src/shared/constants.ts`,
 * `GIT_DELEGATION_COMMAND`) — optional-chained because `import.meta.env` is absent outside Vite.
 * Trailing slashes are stripped here rather than at the call site, so a value pasted with one
 * cannot produce a double slash in the middle of a URL.
 *
 * THE SCHEME IS CHECKED HERE, and here is the only place it can be. `isForeignOrigin` compares
 * origins, and a scheme with no host — `javascript:`, `data:`, `blob:` — has the opaque origin
 * `"null"`, which is not this app's origin and so passes a foreign-ness test truthfully while
 * being exactly the kind of URL that should never reach a frame. Measured: the resulting frame is
 * sandboxed onto an opaque origin and could not read `localStorage['auth-token']`, so this is
 * hardening rather than a hole — but a configured value is operator input, and the honest place
 * to reject a scheme is where the value is read, once, rather than at a gate whose job is
 * origins. A rejected value falls back to the derived default, which is always safe and always
 * available; failing closed to a working embed beats failing open to a scheme nobody intended.
 *
 * AND THE REJECTION IS SAID OUT LOUD, because a silent one is its own bug. An operator who sets
 * this variable and is quietly given the default gets no signal at all: the embed works, so
 * nothing looks wrong, and if it does not the timeout card names the DERIVED origin — a host
 * they never typed — which actively points the investigation away from the setting that was
 * dropped. `eis1:8005` (no scheme) is the easy way to land there. So a rejected value is warned
 * about, naming the value and what was expected.
 */
export function resolveDocSpaceOrigin(): string {
  const configured = import.meta.env?.VITE_DOCSPACE_EMBED_ORIGIN;
  const trimmed = typeof configured === 'string' ? configured.trim().replace(/\/+$/, '') : '';
  if (trimmed && isHttpOrigin(trimmed)) return trimmed;
  if (trimmed) warnIgnoredOrigin(trimmed);
  return `${window.location.protocol}//${window.location.hostname}:${DOCSPACE_EMBED_DEFAULT_PORT}`;
}

/**
 * Whether the ignored-value warning has already been said this session.
 *
 * Module scope, not per call: this function runs once per embed MOUNT, so a transcript with four
 * DocSpace blocks in it would otherwise print the same sentence four times and a long scroll
 * would print it endlessly. The condition is a constant of the session — the env var cannot
 * change under a running page — so saying it more than once adds no information.
 */
let warnedIgnoredOrigin = false;

function warnIgnoredOrigin(value: string): void {
  if (warnedIgnoredOrigin) return;
  warnedIgnoredOrigin = true;
  // `warn`, not `error`: the embed still works on the derived default, so this is a setting that
  // did not take effect rather than a failure. It also keeps the browser probes' console gates —
  // which count errors only — measuring what they were written to measure.
  console.warn(
    `VITE_DOCSPACE_EMBED_ORIGIN was ignored: ${JSON.stringify(value)} is not an absolute ` +
      'http:// or https:// URL. Falling back to this page\'s own hostname on port ' +
      `${DOCSPACE_EMBED_DEFAULT_PORT}.`,
  );
}

/** True only for an absolute `http:`/`https:` URL — the two schemes a DocSpace host can speak. */
function isHttpOrigin(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The address of one block's chrome-less, editable view.
 *
 * Both ids are percent-encoded even though `DOCSPACE_ID_RE` has already refused every character
 * that would need it. That is deliberate belt-and-braces: the encode costs nothing and keeps this
 * function correct on its own terms, so a future caller that skips the classifier cannot mint a
 * path-traversing URL through it.
 *
 * `theme` is the theme of THIS INSTANT, and it only dresses the first paint. Every later flip
 * reaches the frame as a posted `theme` message, never as a new `src` — see `DocSpaceFrame`.
 */
export function docspaceEmbedUrl(origin: string, ref: DocSpaceBlockRef, dark: boolean): string {
  const pageId = encodeURIComponent(ref.pageId);
  const blockId = encodeURIComponent(ref.blockId);
  return `${origin}/embed/block/${pageId}/${blockId}?theme=${dark ? 'dark' : 'light'}`;
}

/**
 * Whether `url` lands somewhere OTHER than this app's own origin — the gate on `allow-same-origin`.
 *
 * Origins, never hostnames: `http://127.0.0.1:5183` and `http://127.0.0.1:8005` share a hostname
 * and are different origins, which is exactly the arrangement this ships in, so a hostname
 * comparison would refuse the normal case. Scheme and port are half the answer.
 *
 * A URL that will not parse returns FALSE — not foreign — because false is the refusing answer
 * here: the caller renders no iframe unless this is true. An address we cannot reason about is
 * therefore not embedded, which is the safe direction to fail in.
 */
export function isForeignOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}
