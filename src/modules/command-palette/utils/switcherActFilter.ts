import { defaultFilter } from 'cmdk';

import type { SwitcherAction } from '@/shared/types';

/**
 * The lowest cmdk match score an act may be listed at. Measured with cmdk's own `defaultFilter`: a prefix, a
 * whole word, or the initials of words scores 0.8 to 0.99; a match that skips letters INSIDE a word scores 0.17
 * or less, and `reload` against Chat's keywords ("Chat chat conversation messages float window panel", the
 * r-e-l-o-a-d of it scattered across five words) scores 0.0028. Nothing between the two, so 0.5 keeps every
 * query a reader means and drops every accident.
 */
const SWITCHER_ACT_MATCH_FLOOR = 0.5;

/**
 * The text cmdk matches a switcher act on: its label and its search words. One function for the two places
 * that must agree on it, the group that hands it to the row and the filter that recognises the row by it.
 */
export function switcherActValue(act: SwitcherAction): string {
  return `${act.label} ${act.keywords}`.trim();
}

/**
 * Used by CommandPalette as its `Command` filter: cmdk's own scoring everywhere, except that a switcher act
 * needs a real match to be listed at all.
 *
 * WHY ONLY THE ACTS. cmdk's match is fuzzy, so a row whose text holds the query's letters in order, scattered
 * anywhere, is kept and ranked last. For a navigation row that is a harmless extra line; for an act it is a
 * state change the reader never named, because cmdk never selects a greyed row and hands the highlight, and
 * so Enter, to the next match: with nothing framed, `reload` + Enter floated the chat. The acts are five
 * verbs, so they are found by a word or its start, and a row that only matched by accident is not shown.
 * Every other row keeps the score cmdk gives it.
 */
export function createSwitcherFilter(actions: SwitcherAction[]) {
  const actValues = new Set(actions.map(switcherActValue));
  return (value: string, search: string, keywords?: string[]): number => {
    const score = defaultFilter(value, search, keywords);
    return actValues.has(value) && score < SWITCHER_ACT_MATCH_FLOOR ? 0 : score;
  };
}
