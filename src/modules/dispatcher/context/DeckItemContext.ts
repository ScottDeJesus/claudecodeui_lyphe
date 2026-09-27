import { createContext } from 'react';

/**
 * What an arc deck tells each of its items, which the caller builds and the frame lays out: the
 * layout the item sits in (a grid cell, or one strip-wide page), and — in the grid — which item a
 * flow node's press is ringing right now and how the item says that ring has ended.
 *
 * A CONTEXT, NOT A PROP, because the items are the CALLER's elements (`DispatchArcDeck` builds one
 * `DeckItem` per plan) while the layout and the ring are the FRAME's state (`DeckFrame`): the caller
 * cannot know which item the reader just jumped to, and the frame cannot reach into elements it was
 * handed whole.
 */
type DeckItemState = {
  /** `grid`: the item is its cell of the tab's wall. `strip`: the item is exactly the strip's width. */
  layout: 'grid' | 'strip';
  /** The item key whose `ring-once` is playing, or `null`; always `null` in a strip. */
  ringing: string | null;
  /** Called by the ringing item on its own ring's `animationend`, so the class leaves with the ring. */
  endRing: (key: string) => void;
};

/** Provided by `DeckFrame` around its body; read by `DeckItem`. Outside a deck an item is a strip page with no ring. */
export const DeckItemContext = createContext<DeckItemState>({ layout: 'strip', ringing: null, endRing: () => undefined });
