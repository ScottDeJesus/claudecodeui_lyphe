import type { DispatcherAsk } from '@/shared/types.js';

import { each, field, isCount, isRecord, isText, names, need, oneOf } from './dispatcher-state.transport.js';

/**
 * A plan's `asking` key, read field by field: the prompt CloudCLI has put up in the plan's owning
 * chat and is still waiting on (`hooks/dispatcher/ask.py:asking`).
 *
 * The plan reader's sibling, under every rule it states once (`dispatcher-plan.reader.ts`): the
 * document is printed whole by a process that has exited, so a key that does not read is a DIFFERENT
 * BUILD of the dispatcher and is refused by name. A made-up prompt is worse than none — its answer
 * runs `dispatcher accept` or `dispatcher tell`, so every word the panel shows and every verb it runs
 * has to be the document's own.
 *
 * READ TOLERANTLY AT THE TOP (`askingSince`): a dispatcher build older than the key writes none, and
 * that reads as "asking nothing" — the plan still draws, the panel stays empty and the Stop hold of
 * that build is what asks. A key that IS there and does not read is still refused.
 */

/** The two kinds the app raises (`ask.KINDS`) — anything else is a build whose prompt this lane cannot answer. */
const ASK_KINDS: readonly DispatcherAsk['kind'][] = ['accept', 'questions'];

/** One of the Accept prompt's three answers, in its contract order (`intent_lock.OPTIONS`). */
function optionOf(raw: unknown): { label: string; description: string } {
  const option = need(raw, isRecord, 'asking.options[]');
  return {
    label: need(field(option, 'label'), isText, 'asking.options[].label'),
    description: need(field(option, 'description'), isText, 'asking.options[].description'),
  };
}

/** One of the designer's questions: its text, and its options exactly as `dispatcher show` prints them. */
function questionOf(raw: unknown): { text: string; options: string[] } {
  const question = need(raw, isRecord, 'asking.questions[]');
  return {
    text: need(field(question, 'text'), isText, 'asking.questions[].text'),
    options: names(field(question, 'options'), 'asking.questions[].options'),
  };
}

/** One open ask whole, its kind read first so every later refusal names the shape it expected. */
function askOf(raw: unknown, where: string): DispatcherAsk {
  const ask = need(raw, isRecord, where);
  const kind = oneOf(field(ask, 'kind'), ASK_KINDS, `${where}.kind`);
  const asked = need(field(ask, 'asked'), isRecord, `${where}.asked`);
  const common = {
    plan: need(field(ask, 'plan'), isText, `${where}.plan`),
    plans: names(field(ask, 'plans'), `${where}.plans`),
    asked: {
      id: need(field(asked, 'id'), isCount, `${where}.asked.id`),
      at: need(field(asked, 'at'), isText, `${where}.asked.at`),
    },
  };
  if (kind === 'accept') {
    const options = each(field(ask, 'options'), `${where}.options`, optionOf);
    // THE THREE, OR NOTHING: an answer is read by its option's POSITION (Accept, Queue, Rework —
    // `intent_lock.OPTIONS`' order is the contract), so a build that offered a different count is a
    // prompt whose answers this lane would misread.
    if (options.length !== 3) throw new Error(`${where}.options: expected the three Accept answers, read ${options.length}`);
    return {
      ...common,
      kind,
      header: need(field(ask, 'header'), isText, `${where}.header`),
      question: need(field(ask, 'question'), isText, `${where}.question`),
      token: need(field(ask, 'token'), isText, `${where}.token`),
      options,
      rework: names(field(ask, 'rework'), `${where}.rework`),
    };
  }
  return {
    ...common,
    kind,
    questions: each(field(ask, 'questions'), `${where}.questions`, questionOf),
    target: need(field(ask, 'target'), isText, `${where}.target`),
  };
}

/**
 * A plan's open ask, or `null` — `null` when the document says so AND when it writes no key at all
 * (a build older than the field). Used by `dispatcher-plan.reader.ts` for `plan.asking`.
 */
export function askingSince(value: unknown, where: string): DispatcherAsk | null {
  if (value === undefined || value === null) return null;
  return askOf(value, where);
}
