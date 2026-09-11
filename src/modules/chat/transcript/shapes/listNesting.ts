import { createContext } from 'react';

/**
 * Whether a list is already being drawn above this one.
 *
 * `ShapeList` sets it around everything it renders and refuses every rung when it reads `true`, so
 * a list nested inside another list is always today's plain list. It exists because the `ul`
 * override fires at every depth, and a shape at depth two is a framed, titled card sitting inside
 * a bullet: the commonest thing this app's own replies write is
 *
 *     - [ ] Phase 4
 *       - [x] Callout
 *       - [ ] Timeline
 *
 * which drew a Tasks card, and then a SECOND Tasks card inside one of its items. The reader wants
 * one read-out at the top and an ordinary indented list under it, and markdown never expressed a
 * framed block inside a list item in the first place.
 *
 * **It is not the streaming flag wearing a hat.** The plan's "no shape reads
 * `MarkdownStreamingContext`" is a rule about that flag, and the reason is that the decision is
 * already made once at the top of the body. Depth is the opposite: it is not knowable at the top,
 * it is not knowable from `node` — hast carries no parent pointer and react-markdown hands an
 * override no ancestry — and it changes as the tree is walked. React context is the only thing in
 * the render that knows it, which is why this is one boolean with one writer and one reader.
 *
 * Used by `elements/list.tsx` and by nothing else.
 */
export const InsideListContext = createContext(false);
