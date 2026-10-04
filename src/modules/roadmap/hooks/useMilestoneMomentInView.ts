import { useEffect } from 'react';
import type { RefObject } from 'react';

import type { Moment } from '@/modules/roadmap/celebrationContext';

/**
 * A milestone moment plays on its station, so a station scrolled out of the surface's view (down the
 * page, or along the sideways rail on a phone) is brought into it first: the smooth scroll lands inside
 * the layer's 900 ms entrance, so the rail's draw, the bloom and the burst play where the reader looks.
 * Instantly under reduced motion, which asks for no travel. A station already in view is left alone, and
 * so is every moment below a milestone's size.
 *
 * Used by `RoadmapPath` (the face's scroller) and `RoadmapWidgetBody` (the chat gutter widget's), each
 * handing it the moment its `useCelebrations` gave and the scroller its stations sit in.
 */
export function useMilestoneMomentInView(moment: Moment | null, scrollRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (moment?.level !== 'milestone') return;
    const scroller = scrollRef.current;
    const station = scroller?.querySelector<HTMLElement>(`[data-roadmap-milestone="${CSS.escape(moment.name)}"]`);
    if (!scroller || !station) return;
    const view = scroller.getBoundingClientRect();
    const box = station.getBoundingClientRect();
    const clipped = box.top < view.top || box.bottom > view.bottom || box.left < view.left || box.right > view.right;
    if (!clipped) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    station.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center', inline: 'center' });
  }, [moment, scrollRef]);
}
