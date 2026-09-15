import { createContext } from 'react';
import type { ReactNode } from 'react';

/**
 * The line above a list or a table, on its way to the frame that will wear it as its title.
 *
 * `remarkShapeGroups` groups a paragraph and the block under it into `<div data-shape="lead-in">`,
 * and `LeadIn` renders the pair: when the target frames itself the paragraph has no home of its own
 * — it becomes that frame's header — and the shape's own `ShapeFrame` is what draws it. The two
 * never meet, so the words travel through this context instead.
 *
 * Written by `LeadIn`, which provides the paragraph's own rendered children; read by `ShapeFrame`,
 * which shows them in place of its `title` prop when they are present. `ShapeFrame` then provides
 * `null` around its own body, so a frame nested under a titled one — a list inside a section — can
 * never inherit a title that belongs to the block above it.
 *
 * It carries `hasLink` beside the words because `ShapeFrame` cannot see the paragraph: a title is
 * rendered children by then, and whether one of them is a link is a fact about the HAST. It matters
 * because the title sits inside the fold's button, and an anchor inside a button is two controls in
 * one.
 *
 * It lives in its own module for the reason `chipContext.ts` and `listNesting.ts` do: `LeadIn.tsx`
 * exports a component, and a context beside it would cost that file its Fast Refresh.
 */
export type LeadInTitle = {
  /** The paragraph's own rendered children: bold, code span and colon intact. */
  title: ReactNode;
  /**
   * True when the line holds a link anywhere. The title sits inside the fold's button, and an `<a>`
   * inside a `<button>` is two controls in one — one click would navigate AND fold. `ShapeFrame`
   * answers it the way `ShapeSection` answers a heading with a link in it: the chevron alone becomes
   * the button and the words are drawn beside it, outside it.
   */
  hasLink: boolean;
};

export const LeadInTitleContext = createContext<LeadInTitle | null>(null);
