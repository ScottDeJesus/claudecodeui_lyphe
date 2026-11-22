import { epochOf } from '@/modules/dispatcher/dispatcherState';
import type { DecidedRow, GapRow } from '@/modules/dispatcher/PlanDecided';

// FILL: samples — the scaffold's fake rows, drawn by no card: delete this file when the real props land in PlanDecided.
// They hold every state the list has: each of the three deciders, a choice about the feature whole (no task), a row
// older than the last look beside newer ones, and one long row with a path that has to break inside its word.

/** Oldest first, as the status JSON hands them. */
export const SAMPLE_DECIDED: readonly DecidedRow[] = [
  {
    id: 41,
    at: '2026-11-21T19:12:00+00:00',
    task: 'The words that teach the forms',
    by: 'builder',
    what: 'Whether the fix-pass brief repeats the DECIDED block or points at the tail',
    choice: 'Repeats it, in the tail\'s own words',
    why: 'A pass is sent the fix brief alone and never sees the tail',
    undo: 'Delete the paragraph from fix_pass_brief; the tail still teaches it to every builder',
  },
  {
    id: 42,
    at: '2026-11-21T20:47:00+00:00',
    task: 'The decider',
    by: 'rule',
    what: 'B2 came back unchanged after the builder\'s answer: the pass that answered round 1 wrote no file',
    choice: 'The finding stands as written: close it the way its fix direction states',
    why: 'It came back unchanged after your answer',
    undo: 'Nothing to undo: the next round reviews the pass',
  },
  {
    id: 43,
    at: '2026-11-21T22:05:00+00:00',
    task: 'The Decided-for-you list on the feature card, composed',
    by: 'builder',
    what: 'Where the gaps stand when the list is folded: inside the fold with the settled choices, or under it where claudecodeui_lyphe/src/modules/dispatcher/PlanDecided.tsx draws them without a press',
    choice: 'Under the fold and outside it, so a gap is in sight on a closed list and on a card that has no decided row at all',
    why: 'A gap is the one thing on this list still moving; a choice already taken can wait behind a press, a gap being healed is what the operator opens the card to check',
    undo: 'Move the data-plan-gaps block inside CollapsibleContent in claudecodeui_lyphe/src/modules/dispatcher/PlanDecided.tsx and drop the gaps-only state from its header comment',
  },
  {
    id: 44,
    at: '2026-11-21T22:31:00+00:00',
    task: null,
    by: 'designer',
    what: 'Whether a ruling changes the design the operator accepted',
    choice: 'It rides in Constraints under its own line; the accepted design is not reloaded',
    why: 'A plan is approved once per load',
    undo: 'Load the design again with the fork decided the other way',
  },
];

export const SAMPLE_GAPS: readonly GapRow[] = [
  { task: 'The decider', title: 'A craft dispute at the ceiling files no decided row for the case that still refuses', ticket: 412, priority: 'high' },
  { task: 'Gaps', title: 'The gap event\'s detail drops the finding\'s severity', ticket: 415, priority: 'medium' },
];

/** A look taken between the second and the third row: two rows read as new, two as seen. */
export const SAMPLE_LAST_LOOK = epochOf('2026-11-21T21:40:00+00:00') ?? 0;
