/**
 * Follows one region's scroller for the station's scroll memory: puts the remembered `scrollTop` back and reports each
 * newer one. Returns the release, which the region's ref callback calls as the node leaves.
 *
 * A REGION THAT HAS NOT YET GROWN TALL ENOUGH is not clamped: setting `scrollTop` past the content's end lands on its
 * end, and the scroll event that follows would report that end as the reader's place and overwrite the remembered one. So
 * the remembered place is applied only once the content can honour it, and until then it waits — retried when the node's
 * subtree changes (a list landing, a card drawing in) — and the wait ends at once when the reader scrolls or presses
 * (their place is theirs from then on) or when it was honoured. `onScroll` hears nothing while the wait stands.
 *
 * Event-driven throughout: a scroll listener and one `MutationObserver`; no timer and no polling.
 */
export function followScroll(node: HTMLElement, remembered: number, onScroll: (top: number) => void): () => void {
  // Whether the remembered place is still waiting to be applied. A local, not state: nothing is drawn from it.
  let waiting = remembered > 0;
  let watcher: MutationObserver | null = null;

  const stopWaiting = () => {
    waiting = false;
    watcher?.disconnect();
    watcher = null;
  };
  const tryRestore = () => {
    if (!waiting) return;
    if (node.scrollHeight - node.clientHeight >= remembered) {
      node.scrollTop = remembered;
      stopWaiting();
    }
  };
  const heardScroll = () => {
    // A scroll while the place still waits is the reader's own (our write is the only other, and it ends the wait first).
    if (waiting) stopWaiting();
    onScroll(node.scrollTop);
  };

  node.addEventListener('scroll', heardScroll, { passive: true });
  if (waiting) {
    node.addEventListener('pointerdown', stopWaiting, { once: true, passive: true });
    tryRestore();
    if (waiting) {
      watcher = new MutationObserver(tryRestore);
      watcher.observe(node, { childList: true, subtree: true });
    }
  }

  return () => {
    node.removeEventListener('scroll', heardScroll);
    node.removeEventListener('pointerdown', stopWaiting);
    watcher?.disconnect();
  };
}
