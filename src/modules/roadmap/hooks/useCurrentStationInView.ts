import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Below 768px the milestone path is a swipe, and it opens on the station the operator is travelling to:
 * the current one (`aria-current`), else the last when every milestone is reached, centred in the track.
 * Done on mount and again on a roadmap switch, instantly and never smooth — it is where the path STARTS,
 * not a move the eye follows. A track that does not overflow has nothing to scroll and is left alone.
 *
 * It reads the stations off the DOM, so it keys on the roadmap's name alone: a new picture of the same
 * roadmap never takes the swipe back from a reader who has moved along it.
 *
 * Used by `MilestonePath`, for its track.
 */
export function useCurrentStationInView(trackRef: RefObject<HTMLElement | null>, roadmapName: string): void {
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track === null || !window.matchMedia('(max-width: 767px)').matches || track.scrollWidth <= track.clientWidth) return;
    const station = track.querySelector<HTMLElement>('[aria-current="step"]') ?? Array.from(track.querySelectorAll<HTMLElement>('[data-roadmap-milestone]')).at(-1);
    if (station === undefined || station === null) return;
    const trackBox = track.getBoundingClientRect();
    const stationBox = station.getBoundingClientRect();
    track.scrollTo({ left: track.scrollLeft + (stationBox.left + stationBox.width / 2) - (trackBox.left + trackBox.width / 2), behavior: 'instant' });
  }, [trackRef, roadmapName]);
}
