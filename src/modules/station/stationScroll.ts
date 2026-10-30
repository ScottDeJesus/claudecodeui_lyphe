import type { StationRegion } from '@/shared/types';

/**
 * How near a scroller's end still counts as standing at it, in px: the conversation's log reads the same distance as "at the
 * newest" (`useFollowNewest`'s `AT_END_SLACK` in the companion module, which keeps it private), so the two agree on what the end is.
 */
const END_SLACK = 48;

/**
 * The regions whose scroller follows its own end: the conversation's log keeps her newest line in sight until he scrolls up. Their
 * place at the end is no place (`followScroll`'s `followsEnd`); every other region's is the offset it stands at.
 */
export const FOLLOWS_END: ReadonlySet<StationRegion> = new Set<StationRegion>(['conversation']);

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
 * A NODE THAT ALREADY STANDS BELOW ITS TOP WHEN IT IS FOLLOWED was put there by its reader (nothing else moves a scroller that is
 * not yet followed), who scrolled before the region bound its memory (the left rail binds it once its two sections are drawn): the
 * remembered place is not put back over his own, and the node is followed from where he left it.
 *
 * A SCROLLER THAT FOLLOWS ITS OWN END (`followsEnd`, the conversation's log, which keeps its newest line in sight) has no place to
 * keep while its reader stands at the end: a `scrollTop` stored there is only "the end" while the content is unchanged, and the
 * log that grew while he was away (her answer, an alert) would put him that many lines above its new end. A place within `END_SLACK`
 * of the end is reported as `null`, no place, so the scroller opens at its newest line as it always does. A list that starts at its
 * top (the rails) keeps an end place as the offset it is.
 *
 * Event-driven throughout: a scroll listener and one `MutationObserver`; no timer and no polling.
 */
export function followScroll(
  node: HTMLElement,
  remembered: number,
  onScroll: (top: number | null) => void,
  followsEnd = false,
): () => void {
  // Whether the remembered place is still waiting to be applied. A local, not state: nothing is drawn from it.
  let waiting = remembered > 0 && node.scrollTop === 0;
  let watcher: MutationObserver | null = null;

  // The place to remember: where the node stands, or none when it follows its end and stands at it.
  const placeOf = (scroller: HTMLElement): number | null =>
    followsEnd && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= END_SLACK ? null : scroller.scrollTop;

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
    onScroll(placeOf(node));
  };

  node.addEventListener('scroll', heardScroll, { passive: true });
  // A reader who scrolled before the bind: his place is the one to remember, whether or not he scrolls again.
  if (!waiting && node.scrollTop !== 0) onScroll(placeOf(node));
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
