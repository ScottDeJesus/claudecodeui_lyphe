/**
 * How a model's `choice` becomes the answer the board stores.
 *
 * Ported from Descent's `mcp_tools.py::_split_choice` and the arity rule in
 * `_h_answer_design_question`, because this is a step the port dropped and its absence was visible
 * on the panel: a value that matched no option was posted as a SELECTION, so a free-form answer
 * arrived in the drawer with nothing to show for it and the decision's own `other` column stayed
 * empty. Descent's rule is the one that makes a free-form answer survive the round trip — a value
 * exactly matching one of the question's options is a selection, EVERY OTHER value is freeform, and
 * the freeform half is what the board's `other` column is for.
 *
 * The two lists are separate from the module that writes them so the rule reads as the rule it is:
 * a lost-value audit of one function, with no board, no HTTP and no card in it.
 *
 * Consumers: `kanban-pm-tools-detail.ts`'s `answer_design_question`.
 */

/** The reason a choice that chose nothing is refused, in one home. */
export const CHOICE_EMPTY_REASON =
  'choice cannot be empty — name one of the question\'s options, or give the free-form answer as ' +
  'a string.';

/** One choice, split into the options it exactly matched and everything else. */
export type ChoiceSplit = {
  selected: string[];
  freeform: string[];
};

/** The split, or the refusal that says why there is none. */
export type ChoiceResolution = ({ ok: true } & ChoiceSplit) | { ok: false; reason: string };

/**
 * The string form of one member of a choice.
 *
 * A number or a boolean is stringified rather than dropped: it can never match a string option, so
 * it lands as freeform — the value the model meant to send, in the bucket that keeps it. `JSON`
 * renders an object or an array so it lands SOMEWHERE instead of arriving as "undefined" or
 * "[object Object]".
 */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  return JSON.stringify(value) ?? '';
}

/**
 * Splits one `choice` against the question's own options.
 *
 * A value is compared to an option EXACTLY, whitespace included: a padded " Yes" is not the option
 * "Yes", and silently trimming it would record a selection the model did not make. Order is kept
 * inside each bucket and a repeated value is kept once, so a lossless answer stays readable.
 *
 * A choice with no non-blank member is refused rather than written. Descent refuses it because an
 * empty `other` is a junk decision in the learning substrate; on this board it is worse than junk —
 * the answer route marks the question answered, and the approve gate counts only unanswered
 * questions, so a blank answer silently opens the gate on a question nobody answered.
 */
export function resolveChoice(
  choice: unknown,
  options: readonly string[],
  multi: boolean
): ChoiceResolution {
  const raw: string[] =
    choice === undefined || choice === null
      ? []
      : Array.isArray(choice)
        ? choice.map(asText)
        : [asText(choice)];

  const values: string[] = [];
  for (const value of raw) {
    if (value.trim() === '') continue;
    if (!values.includes(value)) values.push(value);
  }
  if (values.length === 0) return { ok: false, reason: CHOICE_EMPTY_REASON };

  const optionSet = new Set(options);
  let selected = values.filter((value) => optionSet.has(value));
  let freeform = values.filter((value) => !optionSet.has(value));

  // The arity rule: a SINGLE-choice question handed several matching options keeps the first and
  // demotes the rest into the freeform half — never a silent multi-select on a radio. Demotion
  // rather than dropping, so the answer the model gave is still readable in `other`.
  if (!multi && selected.length > 1) {
    freeform = [...selected.slice(1), ...freeform];
    selected = selected.slice(0, 1);
  }

  return { ok: true, selected, freeform };
}

/**
 * The body the board's answer route takes: the selections, and the freeform half joined.
 *
 * Joined with "; " because the column is one string and a separator is the only way several
 * free-form parts survive in it — the same join Descent writes. The freeform half is sent even when
 * it is empty, so the answer overwrites a previous free-form text rather than leaving it standing
 * under a new selection.
 */
export function answerBody(split: ChoiceSplit): { selected: string[]; other: string } {
  return { selected: split.selected, other: split.freeform.join('; ') };
}
