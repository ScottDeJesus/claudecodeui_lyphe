/**
 * Copies what the chat needs to look like itself into a window's document, and keeps it copied.
 *
 * A picture-in-picture window is a blank document: none of the opener's stylesheets, none of the
 * classes on its `<html>` that carry the theme. The chat is moved into it as live DOM, so it arrives
 * unstyled unless the window's document is made to look like the opener's. Five things do that:
 *
 *  1. `<base href>` from the opener's `baseURI`, so a relative URL in a cloned `<style>` or a chat
 *     image resolves where it does in the opener.
 *  2. Every `<link rel="stylesheet">` and `<style>` of the opener's head, cloned in the opener's order
 *     (the cascade is order) and kept live: Vite's HMR rewrites sheets, and lazy panels add them, long
 *     after the window has opened.
 *  3. The `class`, `style`, `lang`, `dir` and `data-*` attributes of `<html>` and `<body>`, kept live.
 *     That carries `dark`, `pwa-mode`, `vv-anim` and the CSS variables the app sets on the root.
 *  4. `ready`, which settles when the clones have loaded, so the chat is not shown before its styles.
 *  5. `stop`, which lets go of both observers, takes down the `<base>` and the sheets the mirror put in
 *     the target's head, and settles `ready` if it is still pending.
 *
 * THE MIRROR OWNS the target's `<base>` and the sheets it cloned; `stop` removes exactly those, so a
 * second mirror into the same document (a StrictMode mount, cleanup, mount) starts from a clean head
 * instead of stacking a second set of sheets in front of an unobserved first.
 *
 * `ready` MAY SETTLE BECAUSE OF `stop`, so a caller that acts on it (`ready.then(moveChatIn)`) checks
 * its own "still wanted" flag: the promise says the mirror is finished, not that the window is alive.
 *
 * ROOT ATTRIBUTES are written when the SOURCE's value of that attribute changes, not on every opener
 * change (and once, in full, at the start). A `style` or `class` a caller keeps on the target's `<body>`
 * therefore survives a change to a different attribute or to the other element; a change to the same
 * attribute overwrites it wholesale, since a `style` is one string. A caller lays its own structure out
 * in elements INSIDE the body and keeps the body's own `class` and `style` to what the mirror carries.
 *
 * Observers are built from the SOURCE window (`source.defaultView.MutationObserver`) and elements are
 * recognised by `nodeName` and `rel`, never `instanceof`: the two documents belong to different
 * windows, and a constructor from one window does not recognise the other's elements.
 */

/** How long `ready` waits for the cloned links before giving up on them. A link that never reports (a disabled one, a request the browser never settles) must not keep an opened window empty for ever. */
const READY_TIMEOUT_MS = 8000;

/** The root attributes that are copied by name; every `data-*` attribute is copied besides. */
const MIRRORED_ATTRIBUTES = new Set(['class', 'style', 'lang', 'dir']);

type ClonedSheet = HTMLLinkElement | HTMLStyleElement;

function isMirroredAttribute(name: string): boolean {
  return MIRRORED_ATTRIBUTES.has(name) || name.startsWith('data-');
}

/**
 * Carries the mirrored attributes of `from` onto `to`. `lastCopied` is what this element was last told
 * (an attribute's value, or null for "absent"), so a later pass writes only the attributes whose
 * SOURCE value has changed since: whatever else the target's element holds is left alone.
 *
 * `force` is the first pass: it makes the target's mirrored attributes exactly the source's, removing
 * the ones the source lacks, because the target may carry leftovers of an earlier mirror. Attributes
 * outside the mirrored set are never touched.
 */
function syncMirroredAttributes(
  from: Element,
  to: Element,
  lastCopied: Map<string, string | null>,
  force: boolean,
): void {
  const names = new Set<string>(lastCopied.keys());
  for (const attribute of Array.from(from.attributes)) {
    if (isMirroredAttribute(attribute.name)) names.add(attribute.name);
  }
  if (force) {
    for (const attribute of Array.from(to.attributes)) {
      if (isMirroredAttribute(attribute.name)) names.add(attribute.name);
    }
  }
  for (const name of names) {
    const wanted = from.getAttribute(name);
    if (!force && wanted === (lastCopied.get(name) ?? null)) continue;
    if (wanted === null) to.removeAttribute(name);
    else if (to.getAttribute(name) !== wanted) to.setAttribute(name, wanted);
    lastCopied.set(name, wanted);
  }
}

function isStylesheetLink(element: Element): element is HTMLLinkElement {
  if (element.nodeName !== 'LINK') return false;
  return (element as HTMLLinkElement).rel.toLowerCase().split(/\s+/).includes('stylesheet');
}

/**
 * What makes two sheets the same sheet, or null for an element that is not one.
 *
 * A link is its ABSOLUTE href (the property, not the attribute) and how it is fetched; a style is its
 * text. Two sheets with one key are interchangeable, which is what lets a re-mirror keep the clone
 * that has already loaded instead of replacing it.
 */
function sheetKey(element: Element): string | null {
  if (element.nodeName === 'STYLE') {
    const style = element as HTMLStyleElement;
    return `style\n${style.media}\n${style.textContent ?? ''}`;
  }
  if (isStylesheetLink(element)) {
    return `link\n${element.href}\n${element.media}\n${element.crossOrigin ?? ''}`;
  }
  return null;
}

/** A copy of `sheet` made in the target document, so it is born there rather than adopted. */
function cloneSheet(sheet: Element, target: Document): ClonedSheet {
  if (sheet.nodeName === 'STYLE') {
    const style = target.createElement('style');
    style.textContent = sheet.textContent;
    if ((sheet as HTMLStyleElement).media) style.media = (sheet as HTMLStyleElement).media;
    return style;
  }
  const source = sheet as HTMLLinkElement;
  const link = target.createElement('link');
  link.rel = 'stylesheet';
  link.href = source.href;
  if (source.media) link.media = source.media;
  link.crossOrigin = source.crossOrigin;
  return link;
}

/** A promise that settles when a link has loaded or failed; either way its styles are as ready as they will get. */
function linkSettled(link: HTMLLinkElement): Promise<void> {
  return new Promise((resolve) => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
  });
}

/**
 * Copies what the chat needs to look like itself from `source` into `target`, and keeps it copied
 * until `stop()`. `ready` settles once every stylesheet link cloned at the start has loaded or failed
 * (at once when there are none), after `READY_TIMEOUT_MS` if one never reports, or when `stop()` runs.
 * `stop()` also removes the sheets and the `<base>` the mirror put in the target's head.
 *
 * Used by chat-host's picture-in-picture window, which mirrors the opener into the new window's
 * document before the chat is moved in, and stops the mirror when the window closes.
 */
export function mirrorDocument(source: Document, target: Document): { ready: Promise<void>; stop: () => void } {
  const sourceWindow = source.defaultView;
  if (!sourceWindow) throw new Error('mirrorDocument: the source document is not attached to a window.');

  const targetHead = target.head;
  // A <base> the target already had is reused and left standing at `stop`; one made here is removed.
  const existingBase = targetHead.querySelector('base');
  const base = existingBase ?? target.createElement('base');
  if (!base.parentNode) targetHead.insertBefore(base, targetHead.firstChild);

  // The clones made on the last pass, in source order. Kept so the next pass can hand a clone that
  // matches back instead of building a new one: a link that has loaded stays loaded, and the window
  // never flashes unstyled while a sheet elsewhere in the head changes.
  let mirrored: Array<{ key: string; element: ClonedSheet }> = [];

  /**
   * Brings the target's head in line with the source's. `loads`, when given, collects a promise for
   * every link clone this pass creates — the first pass hands one in, so `ready` can wait on it.
   */
  function mirrorHead(loads?: Array<Promise<void>>): void {
    const href = source.baseURI;
    if (base.getAttribute('href') !== href) base.setAttribute('href', href);

    const spare = new Map<string, ClonedSheet[]>();
    for (const clone of mirrored) spare.set(clone.key, [...(spare.get(clone.key) ?? []), clone.element]);

    const next: typeof mirrored = [];
    for (const child of Array.from(source.head.children)) {
      const key = sheetKey(child);
      if (key === null) continue;
      let element = spare.get(key)?.shift();
      if (!element) {
        element = cloneSheet(child, target);
        if (loads && element.nodeName === 'LINK') loads.push(linkSettled(element as HTMLLinkElement));
      }
      next.push({ key, element });
    }
    for (const unused of spare.values()) {
      for (const element of unused) element.remove();
    }
    mirrored = next;

    // Order is the cascade. A kept clone is already where it belongs and is not touched — moving a
    // link would reload it — so only the clones out of place, or new, are inserted.
    let previous: Node = base;
    for (const { element } of next) {
      if (previous.nextSibling !== element) targetHead.insertBefore(element, previous.nextSibling);
      previous = element;
    }
  }

  // What each root element was last told, per attribute, so a later pass writes only what changed at the source.
  const htmlLastCopied = new Map<string, string | null>();
  const bodyLastCopied = new Map<string, string | null>();

  function mirrorRootAttributes(force: boolean): void {
    syncMirroredAttributes(source.documentElement, target.documentElement, htmlLastCopied, force);
    if (source.body && target.body) syncMirroredAttributes(source.body, target.body, bodyLastCopied, force);
  }

  const initialLoads: Array<Promise<void>> = [];
  mirrorHead(initialLoads);
  mirrorRootAttributes(true);

  // One callback per burst of records: every mutation of a task is delivered together, and the pass
  // reads the head afresh, so the records themselves carry nothing it needs. `attributes` on the
  // sheet-carrying attributes catches a link whose `href` is rewritten in place, which is no
  // childList change at all.
  const headObserver = new sourceWindow.MutationObserver(() => mirrorHead());
  headObserver.observe(source.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['href', 'media', 'rel', 'crossorigin'],
  });

  // An arrow, not the function itself: an observer callback is handed its records, which `force` must not be.
  const rootObserver = new sourceWindow.MutationObserver(() => mirrorRootAttributes(false));
  rootObserver.observe(source.documentElement, { attributes: true });
  if (source.body) rootObserver.observe(source.body, { attributes: true });

  let readyTimer: number | undefined;
  let settleReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    settleReady = resolve;
    if (initialLoads.length === 0) {
      resolve();
      return;
    }
    readyTimer = sourceWindow.setTimeout(resolve, READY_TIMEOUT_MS);
    void Promise.all(initialLoads).then(() => {
      sourceWindow.clearTimeout(readyTimer);
      resolve();
    });
  });

  return {
    ready,
    stop: () => {
      headObserver.disconnect();
      rootObserver.disconnect();
      sourceWindow.clearTimeout(readyTimer);
      // Settled here so its outcome does not hang on whether a link happened to load: without this a
      // stopped mirror's `ready` stayed pending for ever on a link that never reports, and resolved
      // late on one that was merely slow.
      settleReady();
      // The clones are the mirror's own; leaving them would stack a second mirror's sheets in front of
      // an unobserved first set, and the stale first set would win the cascade.
      for (const { element } of mirrored) element.remove();
      mirrored = [];
      if (!existingBase) base.remove();
    },
  };
}
