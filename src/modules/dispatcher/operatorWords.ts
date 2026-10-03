/** The words a house sentence names its work with, and the operator's word for each. */
const OPERATOR_WORD: Readonly<Record<string, string>> = {
  plan: 'feature',
  plans: 'features',
  'plan(s)': 'feature(s)',
  arc: 'epic',
  arcs: 'epics',
  'arc(s)': 'epic(s)',
  phase: 'task',
  phases: 'tasks',
  'phase(s)': 'task(s)',
};

/** The three words an identifier-shaped `key=value` token opens with, and the operator's word for each. */
const OPERATOR_KEY: Readonly<Record<string, string>> = { arc: 'epic', plan: 'feature', phase: 'task' };

// What may stand against a word without being part of it. A token's lead is a run of OPENERS; its
// tail is an optional possessive and then a run of CLOSERS.
const OPENERS = '(["\'“‘';
const CLOSERS = ')]"\'”’.,:;!?';
const POSSESSIVES = ["'s", '’s'];

/** `plan(s)` and its kin: the counted plural, whose own `)` is a closer and so must be read whole first. */
const COUNTED_PLURAL = /^((?:plan|arc|phase)\(s\))((?:['’]s)?[)\]"'”’.,:;!?]*)$/i;

/** `<name>.arc`, the CLI's door to an arc, its name in the store's own shape (`store.NAME_RE`). */
const ARC_DOOR = /^([a-z0-9][a-z0-9-]*)\.arc$/;

/** An identifier that opens with one of the three words as a key: `arc=restorly`, `plan=x`, `phase=a-1`. */
const KEYED_VALUE = /^(arc|plan|phase)=/;

/** One whitespace-free piece of a sentence, taken apart so only its core is ever read. */
type TokenParts = { lead: string; core: string; tail: string };

/** The token as lead + core + tail; the three joined are always the token itself. */
function splitToken(token: string): TokenParts {
  let coreStart = 0;
  while (coreStart < token.length && OPENERS.includes(token[coreStart])) coreStart += 1;

  // Counted plurals come BEFORE the closing run is peeled: peeled first, the run takes the `)` and
  // the core becomes `plan(s`, and `2 plan(s)` would pass untranslated.
  const counted = COUNTED_PLURAL.exec(token.slice(coreStart));
  if (counted) return { lead: token.slice(0, coreStart), core: counted[1], tail: counted[2] };

  let coreEnd = token.length;
  while (coreEnd > coreStart && CLOSERS.includes(token[coreEnd - 1])) coreEnd -= 1;
  if (coreEnd - 2 >= coreStart && POSSESSIVES.includes(token.slice(coreEnd - 2, coreEnd))) coreEnd -= 2;
  return { lead: token.slice(0, coreStart), core: token.slice(coreStart, coreEnd), tail: token.slice(coreEnd) };
}

/** `translated` in the case `core` was written in, or `null` for a mix this function does not read. */
function inCaseOf(core: string, translated: string): string | null {
  if (core === core.toLowerCase()) return translated;
  if (core === core.toUpperCase()) return translated.toUpperCase();
  if (core[0] === core[0].toUpperCase() && core.slice(1) === core.slice(1).toLowerCase()) {
    return translated[0].toUpperCase() + translated.slice(1);
  }
  return null;
}

/** What a token's core becomes in the operator's words — the core itself when it is not one this reads. */
function operatorCore(core: string, keep: readonly string[]): string {
  if (keep.includes(core)) return core;

  const door = ARC_DOOR.exec(core);
  if (door) return door[1];

  const keyed = KEYED_VALUE.exec(core);
  if (keyed) return `${OPERATOR_KEY[keyed[1]]}${core.slice(keyed[1].length)}`;

  const lowered = core.toLowerCase();
  // An own-property read: `constructor` and `__proto__` are words a sentence can carry.
  if (!Object.prototype.hasOwnProperty.call(OPERATOR_WORD, lowered)) return core;
  return inCaseOf(core, OPERATOR_WORD[lowered]) ?? core;
}

/**
 * A house sentence in the operator's words: CloudCLI names a plan a feature, an arc an epic and a
 * phase a task, while the house's own text — its verbs' stdout, its posture, a planner's outcome —
 * keeps plan, arc and phase. This is the one place the two meet, so a sentence the dispatcher said
 * verbatim reaches the operator in his words and the dispatcher's own bytes stay what they are.
 *
 * THE LINE IT DRAWS is the whole token. Only a word that is EXACTLY `plan`, `arc` or `phase` (or
 * its plural, possessive or counted `(s)` plural, in its own case), the arc door `<name>.arc`, and
 * an `arc=`/`plan=`/`phase=` key are read; each token's quotes, brackets and punctuation stand
 * around the word it names. `plan-runner-fix`, `plans/x.toml`, `--arc`, `model=claude` and a chain
 * id are identifiers the operator may paste back into a terminal, so they pass byte for byte, as
 * does every run of whitespace between tokens. A word equal to one of `keep` is a NAME the sentence
 * is about — a plan that is literally called `plan` — and is never read.
 *
 * Used by `useDispatcherVerbs` for the toast that answers a press, by `PlanFace` for the posture its
 * caption carries and by `PlannerBadge` for the cause a stalled planner outing ended on. The events
 * feed and the stage lines are not read through it; they show the dispatcher's words as written.
 */
export function operatorWords(text: string, keep: readonly string[] = []): string {
  return text
    .split(/(\s+)/)
    .map((piece, index) => {
      // The odd entries are the whitespace runs the split captured, rejoined unchanged.
      if (index % 2 === 1) return piece;
      const { lead, core, tail } = splitToken(piece);
      return lead + operatorCore(core, keep) + tail;
    })
    .join('');
}
