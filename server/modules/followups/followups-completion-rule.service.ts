import type { FollowupCompletionArc, FollowupCompletionPlan } from '@/shared/types.js';

/**
 * The rule that decides which open follow-ups a finished feature, task or epic settles — pure, with no database and no clock.
 *
 * A follow-up is one free-text line, so "points at a feature" can only mean "names it". The rule is idempotent and
 * stateless: it reads stamps, never a mark of what was already swept, so running it on every picture the dispatcher
 * sends — and again after a restart — closes exactly what the stamps say and nothing twice.
 *
 *  - A FEATURE finished (`completed_at` set): every open item that names the feature and has stood untouched since
 *    before the stamp.
 *  - A TASK finished (`status` done, `done_at` set): every open item that has stood untouched since before the stamp,
 *    names the feature AND points at that task. Task keys are ordinary words (`card`, `switch`, `feed`), so a bare word
 *    never counts — only the forms in `pointsAtTask`.
 *  - An EPIC finished (`status` complete, at the time `epicFinishedAt` gives): every open item that names the epic and
 *    has stood untouched since before that time. The time is the latest stamp among the epic's own and its plans' — the
 *    epic's own stamp is written once and is never the finish of an epic that was judged after it, took on new plans,
 *    or was made by the roadmap (never stamped).
 *  - An item filed AFTER a stamp is never touched, however it reads. A feature or task closure claims an item before an
 *    epic closure can (the caller runs the plans first): one item, one `closedFor`.
 *
 * THE THREE `closed_for` FORMS: `<feature>`, `<feature>/<task key>` and `epic:<epic>`. A slug never holds a colon, so
 * the `epic:` prefix cannot collide with a feature name; whoever splits a `closed_for` tests the prefix BEFORE the slash.
 *
 * WHAT "NAMES" MEANS (`namesThing`). A hyphenated name (`drying-report-direct-readers`) is unmistakable and counts as a
 * bare whole token. A name with no hyphen is an ordinary word — an epic called `kaylee` is also her name, a feature
 * called `dactyls` is a word — so it counts only with a cue: `epic <name>` / `<name> epic` (`feature` for a feature),
 * or the name in quotes or backticks.
 *
 * "UNTOUCHED SINCE" IS `updated_at`, NOT `created_at`. An open item's `updated_at` is its `created_at` until a person
 * unticks it in the widget, which sets it to now — later than every stamp the lane already holds. Compared on
 * `created_at`, the rule would close the item again on the next picture (seconds later), and an untick would never
 * hold. Compared on `updated_at`, a reopened item is left open for good, and the rule still keeps no mark of its own.
 *
 * The dispatcher names these things arc, plan and phase; the code keeps those words, and the strings a person reads say
 * "epic", "feature" and "task" (`FollowupRow.tsx`, `bin/followups.mjs`).
 */

/** The characters a feature name, epic name or task key may not touch on either side to count as a whole token. */
const TOKEN_EDGE = '[A-Za-z0-9_-]';

/** What an epic's `closed_for` starts with. A slug never holds a colon, so no feature name can collide with it. */
const EPIC_CLOSED_FOR_PREFIX = 'epic:';

/** What the rule reads of an open item: its id, its line, and when it last changed (`updated_at`: the filing, or a person's untick). */
type OpenItem = { id: number; text: string; updated_at: string };

/** One batch of items a stamp settles: close `ids` as done at `doneAt` (ISO-8601 UTC, milliseconds), recording `closedFor`. */
export type CompletionClosure = { ids: number[]; doneAt: string; closedFor: string };

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `literal` as a whole token: not preceded or followed by a character of a slug, so `a-b` does not match inside `a-b-v2`. */
function wholeToken(literal: string): string {
  return `(?<!${TOKEN_EDGE})${escapeForRegExp(literal)}(?!${TOKEN_EDGE})`;
}

/**
 * Whether the line names the feature or epic `name`, in any case. A hyphenated name counts as a bare whole token. A name
 * with no hyphen counts only with a cue: `<thing> <name>` or `<name> <thing>` (`thing` is `feature` or `epic`), or the
 * name between two matching quotes or backticks — the quote not glued to a word on its outer side, so the apostrophe
 * of `kaylee's` does not open one.
 */
function namesThing(text: string, name: string, thing: 'feature' | 'epic'): boolean {
  if (name.includes('-')) return new RegExp(wholeToken(name), 'i').test(text);

  const word = wholeToken(name);
  const cues = [
    `${wholeToken(thing)}\\s+${word}`,
    `${word}\\s+${wholeToken(thing)}`,
    `(?<!${TOKEN_EDGE})(['"\`])${escapeForRegExp(name)}\\1(?!${TOKEN_EDGE})`,
  ];

  return cues.some((cue) => new RegExp(cue, 'i').test(text));
}

/**
 * Whether the line, which already names the feature, points at one of its tasks. Only these forms count, any case,
 * with the key bounded like a token: the key right after the feature name joined by one space, `/` or `:`
 * (`drying-report-direct-readers/booth`, `drying-report-direct-readers booth`); or the words `phase <key>`,
 * `task <key>`, `<key> phase`, `<key> task` anywhere in the line.
 */
function pointsAtTask(text: string, feature: string, taskKey: string): boolean {
  const key = wholeToken(taskKey);
  const forms = [
    `${wholeToken(feature)}[ /:]${key}`,
    `${wholeToken('phase')} ${key}`,
    `${wholeToken('task')} ${key}`,
    `${key} ${wholeToken('phase')}`,
    `${key} ${wholeToken('task')}`,
  ];

  return forms.some((form) => new RegExp(form, 'i').test(text));
}

/** The dispatcher's stamp as milliseconds, or `null` when it is missing or unreadable (an unreadable stamp closes nothing). */
function stampMs(stamp: string | null): number | null {
  if (stamp === null) return null;
  const ms = Date.parse(stamp);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The closure `stamp` makes of the `items` that stood untouched since strictly before it (an item a person unticked
 * after the stamp holds), or `null` when the stamp is missing or unreadable or no item stood that long.
 */
function closureAt(items: OpenItem[], stamp: string | null, closedFor: string): CompletionClosure | null {
  const at = stampMs(stamp);
  if (at === null) return null;

  const ids = items
    .filter((item) => {
      const standingSince = stampMs(item.updated_at);
      return standingSince !== null && standingSince < at;
    })
    .map((item) => item.id);

  return ids.length === 0 ? null : { ids, doneAt: new Date(at).toISOString(), closedFor };
}

/**
 * What the plan's finished feature and tasks settle among `candidates` — the open items whose text contains the plan's
 * name (a wide net the caller cast; this applies the exact rule). Answers one closure for the feature (when it finished)
 * and one per finished task that settles something not already settled, in the plan's task order. Used by
 * `followups.service.ts` (`closeForCompletions`), which reads the candidates and writes the closures.
 */
export function closuresForPlan(plan: FollowupCompletionPlan, candidates: OpenItem[]): CompletionClosure[] {
  const named = candidates.filter((item) => namesThing(item.text, plan.name, 'feature'));
  const closures: CompletionClosure[] = [];
  const settled = new Set<number>();

  const settle = (stamp: string | null, closedFor: string, qualifies: (item: OpenItem) => boolean): void => {
    const closure = closureAt(
      named.filter((item) => !settled.has(item.id) && qualifies(item)),
      stamp,
      closedFor,
    );
    if (closure === null) return;

    for (const id of closure.ids) settled.add(id);
    closures.push(closure);
  };

  settle(plan.completed_at, plan.name, () => true);
  for (const phase of plan.phases) {
    if (phase.status !== 'done') continue;
    settle(phase.done_at, `${plan.name}/${phase.key}`, (item) => pointsAtTask(item.text, plan.name, phase.key));
  }

  return closures;
}

/**
 * When the epic finished, as the dispatcher's own stamp, or `null` while it has not: the epic's `status` is `complete`
 * and it holds at least one readable stamp. The finish is the LATEST stamp among the epic's own `completed_at` and the
 * `completed_at` of each of its plans found in `plans`, because the epic's own stamp is not the finish:
 *  - it is written once and never moved, and a designed-whole epic is stamped when its last feature finishes, hours
 *    before its judgment plan ends and the epic reads `complete`;
 *  - an epic that completed once and took on new plans (`kaylee`) reads `live` while it keeps that old stamp, and
 *    reads `complete` again only when the new plans end;
 *  - an epic the roadmap made is never stamped at all, yet reads `complete` off its plans.
 * So an item filed while the epic's last plan was still walking is not stale: it closes when the epic finishes. A
 * plan the picture no longer carries (the lane drops one 24 h after it ends) simply adds no stamp. Used by
 * `followups.service.ts` (`closeForCompletions`), which skips the candidate read for an epic that has not finished,
 * and hands the stamp to `closuresForArc`.
 */
export function epicFinishedAt(arc: FollowupCompletionArc, plans: FollowupCompletionPlan[]): string | null {
  if (arc.status !== 'complete') return null;

  const ownPlans = new Set(arc.plans);
  const stamps = [arc.completed_at, ...plans.filter((plan) => ownPlans.has(plan.name)).map((plan) => plan.completed_at)];

  let latest: { stamp: string; ms: number } | null = null;
  for (const stamp of stamps) {
    const ms = stampMs(stamp);
    if (stamp !== null && ms !== null && (latest === null || ms > latest.ms)) latest = { stamp, ms };
  }

  return latest === null ? null : latest.stamp;
}

/**
 * What the epic settles among `candidates` once it finished at `finishedAt` (`epicFinishedAt`) — the open items whose
 * text contains the epic's name (a wide net the caller cast; this applies the exact rule, `namesThing`). Answers the one
 * closure, recorded as `epic:<name>`, or none when nothing named it before the finish. Used by `followups.service.ts`
 * (`closeForCompletions`), which reads the candidates after the plans' closures were written, so an item a feature or
 * task already claimed is no longer among them.
 */
export function closuresForArc(arc: FollowupCompletionArc, finishedAt: string, candidates: OpenItem[]): CompletionClosure[] {
  const named = candidates.filter((item) => namesThing(item.text, arc.name, 'epic'));
  const closure = closureAt(named, finishedAt, `${EPIC_CLOSED_FOR_PREFIX}${arc.name}`);

  return closure === null ? [] : [closure];
}
