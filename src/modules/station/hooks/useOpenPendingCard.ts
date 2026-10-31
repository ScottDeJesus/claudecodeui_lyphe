import { useLayoutEffect, useRef } from 'react';

import type { StationCompactSection } from '@/shared/types';

/** Her action's card as the rail draws it: the head of Needs you (`CompanionActionCard`'s root). */
const PENDING_CARD = '[data-station-section="needs"] [data-companion-action]';

/** Scrolls the rail's own scroller just far enough that the card stands whole in it; nothing happens while no card is drawn. */
function bringCardIntoView() {
  document.querySelector(PENDING_CARD)?.scrollIntoView({ block: 'nearest' });
}

/**
 * The press of the phone's pending line: it selects Needs you AND brings the card it points at into view. Consumed by
 * `StationPhone`.
 *
 * The line only points; the whole card, with his lines word for word, stands at the head of Needs you (MAN-9186). The rail keeps
 * its place across a visit elsewhere (the station's scroll memory), so a rail he left scrolled down would open with the card above
 * its top and the line would point at nothing he can see. The press therefore owes the card its view: spent once Needs you is the
 * section drawn (the section's own change lands a render after the press, and the card is measured only while its section is
 * shown), or at once when it already is.
 *
 * Follows the press and the section's change and nothing else: no timer, no poll. A LAYOUT effect, so the card is in place before
 * the paint that first shows the section.
 */
export function useOpenPendingCard(
  section: StationCompactSection,
  setSection: (next: StationCompactSection) => void,
): () => void {
  // Whether a press has asked to see the card and Needs you has not yet been drawn. A ref: the effect below spends it, and nothing
  // is drawn from it.
  const owed = useRef(false);

  useLayoutEffect(() => {
    if (section !== 'needs' || !owed.current) return;
    owed.current = false;
    bringCardIntoView();
  }, [section]);

  return () => {
    if (section === 'needs') {
      bringCardIntoView();
      return;
    }
    owed.current = true;
    setSection('needs');
  };
}
