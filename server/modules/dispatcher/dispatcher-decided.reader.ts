import type { DispatcherDecided, DispatcherDecidedBy, DispatcherGap, DispatcherPhaseRuling } from '@/shared/types.js';

import { each, field, isCount, isRecord, isText, isTextOrNull, need, oneOf } from './dispatcher-state.transport.js';

/**
 * What a plan's walks decided FOR the operator and the gaps they finished with (`report.plan_dict`'s
 * `decided` and `open_gaps`), and whether a phase waits on its designer's ruling
 * (`report.phase_dict.ruling`).
 *
 * EITHER SIDE MAY LAND FIRST. A dispatcher build older than these keys writes none of them, and an
 * absent key reads as what that build means — nothing decided, no gap open, no ruling asked — so the
 * card draws what it always drew. A key that IS there and does not match is refused by name, as every
 * other field of the document is (`dispatcher-plan.reader.ts` says why).
 */

const DECIDED_BY: readonly DispatcherDecidedBy[] = ['builder', 'rule', 'designer'];
const RULING_WORDS: readonly DispatcherPhaseRuling[] = ['asked'];

/** A plan's `decided` rows, oldest first; `[]` when the key is absent. */
export function decidedSince(value: unknown, where: string): DispatcherDecided[] {
  return value === undefined ? [] : each(value, where, (entry) => decidedOf(entry, where));
}

/** A plan's `open_gaps`; `[]` when the key is absent. */
export function gapsSince(value: unknown, where: string): DispatcherGap[] {
  return value === undefined ? [] : each(value, where, (entry) => gapOf(entry, where));
}

/** A phase's `ruling`: `asked`, or `null` when it is `null` or absent. */
export function rulingSince(value: unknown, where: string): DispatcherPhaseRuling | null {
  return value === undefined || value === null ? null : oneOf(value, RULING_WORDS, where);
}

function decidedOf(raw: unknown, where: string): DispatcherDecided {
  const row = need(raw, isRecord, where);
  return {
    id: need(field(row, 'id'), isCount, `${where}.id`),
    at: need(field(row, 'at'), isText, `${where}.at`),
    task: need(field(row, 'task'), isTextOrNull, `${where}.task`),
    by: oneOf(field(row, 'by'), DECIDED_BY, `${where}.by`),
    what: need(field(row, 'what'), isText, `${where}.what`),
    choice: need(field(row, 'choice'), isText, `${where}.choice`),
    why: need(field(row, 'why'), isText, `${where}.why`),
    undo: need(field(row, 'undo'), isText, `${where}.undo`),
  };
}

function gapOf(raw: unknown, where: string): DispatcherGap {
  const gap = need(raw, isRecord, where);
  return {
    task: need(field(gap, 'task'), isText, `${where}.task`),
    title: need(field(gap, 'title'), isText, `${where}.title`),
    ticket: need(field(gap, 'ticket'), isCount, `${where}.ticket`),
    priority: need(field(gap, 'priority'), isText, `${where}.priority`),
  };
}
