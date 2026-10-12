import { useEffect } from 'react';
import type { RefObject } from 'react';

import type { Moment } from '@/modules/roadmap/celebrationContext';

/**
 * A milestone moment plays on its ring in the tree, so a ring scrolled out of the surface's view (along
 * the tree's sideways pane, or down the gutter column) is brought into it first: the smooth scroll lands
 * inside the layer's 900 ms entrance, so the connector's draw, the bloom and the burst play where the
 * reader looks. Instantly under reduced motion, which asks for no travel. A milestone already in view is
 * left alone, and so is every moment below a milestone's size.
 *
 * Used by `RoadmapTreeFace`, handing it the moment its `useCelebrations` gave and the scroller that can
 * hide the milestone's node: the tree's own pane in viewport fit, the column's scroller in column fit.
 */
export function useMilestoneMomentInView(moment: Moment | null, scrollRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (moment?.level !== 'milestone') return;
    const scroller = scrollRef.current;
    const node = scroller?.querySelector<HTMLElement>(`[data-roadmap-milestone="${CSS.escape(moment.name)}"]`);
    if (!scroller || !node) return;
    const view = scroller.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    const clipped = box.top < view.top || box.bottom > view.bottom || box.left < view.left || box.right > view.right;
    if (!clipped) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center', inline: 'center' });
  }, [moment, scrollRef]);
}
