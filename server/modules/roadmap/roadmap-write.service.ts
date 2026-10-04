import type { RoadmapAct, RoadmapKind } from '@/shared/roadmap-types.js';

/**
 * A request body becomes the dispatcher's argv here, or a sentence saying which field is wrong.
 *
 * THE ARGV IS THE BOUNDARY, as `@/shared/dispatcher-command.ts` says of every dispatcher command: no shell parses
 * any of it. What a request may choose is a VALUE, never a word. The act, the kind, the verb, every
 * flag name and the actor are spelled in this file and nowhere else, so nothing a request carries
 * can become a flag. Free text (title, goal, reason, project, repo) rides as ONE argv string in the
 * `--flag=value` form, which is what lets a title the operator starts with a dash reach the
 * dispatcher as a title rather than as an option of its own.
 *
 * THE TEXT IS FENCED TWICE. Each field is checked here against the limits the store enforces
 * (`store_roadmap.py`'s `_FIELDS`, with the repo held tighter), so a body the store would refuse
 * never spawns a process; the store then refuses again with its own words, which is the one place
 * that decides. This file decides no word and mints no name: an add without a `name` lets the
 * dispatcher mint one from the title and print it in its `ADDED` line.
 */

/** A parsed body: a plain JSON object, every field still `unknown` until a fence has read it. */
type Body = Record<string, unknown>;

/**
 * A fence that said no. Thrown inside this file only, so each fence stays one line, and caught by
 * `writeArgv` alone: nothing outside ever sees it, and any other error passes through untouched.
 */
class BodyRefusal extends Error {}

function refuse(sentence: string): never {
  throw new BodyRefusal(sentence);
}

const ALL_KINDS: readonly RoadmapKind[] = ['roadmap', 'milestone', 'arc', 'plan'];

/** A roadmap carries no blocked mark: it is the whole path, not a place on it. */
const BLOCKABLE_KINDS: readonly RoadmapKind[] = ['milestone', 'arc', 'plan'];

/**
 * The flag that names a kind's parent on an add, and the noun the 400 sentence calls that parent.
 * A roadmap has none. A parent is always a NAME, so the flag and its value ride as two argv words.
 */
const PARENT_OF: Record<RoadmapKind, { flag: string; noun: string } | null> = {
  roadmap: null,
  milestone: { flag: '--roadmap', noun: 'roadmap' },
  arc: { flag: '--milestone', noun: 'milestone' },
  plan: { flag: '--arc', noun: 'arc' },
};

/**
 * The optional text an add of each kind takes beyond title and goal. The dispatcher's own parser
 * refuses a flag its kind does not take with a usage page on stderr and nothing on stdout, so the
 * fence says it in one sentence instead.
 */
const ADD_TAKES: Record<RoadmapKind, readonly string[]> = {
  roadmap: [],
  milestone: [],
  arc: ['repo'],
  plan: ['repo', 'project'],
};

/**
 * Who is writing: the screen. `--by app:card` is the actor the dispatcher records for a press made
 * on the app, and every argv ends with it.
 */
const ACTOR: readonly string[] = ['--by', 'app:card'];

/**
 * The dispatcher's own name rule (`store.NAME_RE`), written out for the reason the plan lane's is.
 * Consumed by this file's fence and by the router's `GET /cases`, which fences its `feature` query
 * to the same rule before the cases door is asked about it.
 */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;

/**
 * Every character Python's `str.splitlines()` breaks a line on, which is how the store counts "one
 * line": a title the store would read as two is a title this fence refuses.
 */
const LINE_BREAK = /[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/;

/** The limits of one text field, in characters (code points, as the store counts them). */
type TextFence = { min: number; max: number; oneLine: boolean };

const TITLE_FENCE: TextFence = { min: 1, max: 120, oneLine: true };
const GOAL_FENCE: TextFence = { min: 0, max: 8000, oneLine: false };
const WHY_FENCE: TextFence = { min: 1, max: 1000, oneLine: true };
const PROJECT_FENCE: TextFence = { min: 0, max: 40, oneLine: true };
const REPO_FENCE: TextFence = { min: 1, max: 400, oneLine: false };

/** `a, b or c` — the closed words a sentence offers. */
function sayList(words: readonly string[]): string {
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}

/** `a plan`, `an arc`: the kind with the article its first letter asks for, for the sentences that name one. */
function withArticle(kind: RoadmapKind): string {
  return `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`;
}

function describeFence(field: string, fence: TextFence): string {
  const size = fence.min > 0 ? `${fence.min} to ${fence.max}` : `at most ${fence.max}`;
  return `${field} must be ${fence.oneLine ? 'one line of ' : ''}${size} characters`;
}

function readBody(body: unknown): Body {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return refuse('the body must be a JSON object');
  }
  return body as Body;
}

/** A field's value, or `undefined` when it is absent or null — both mean "not given". */
function given(body: Body, field: string): unknown {
  const value = body[field];
  return value === null ? undefined : value;
}

/** `kind`, read against the closed list this act admits. */
function readKind(body: Body, allowed: readonly RoadmapKind[]): RoadmapKind {
  const value = given(body, 'kind');
  const kind = allowed.find((candidate) => candidate === value);
  return kind ?? refuse(`kind must be one of ${sayList(allowed)}`);
}

/** A name-shaped field (a name, a parent, a sibling), or `undefined` when it is not given. */
function readName(body: Body, field: string): string | undefined {
  const value = given(body, field);
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !NAME_PATTERN.test(value)) {
    return refuse(`${field} must be 1 to 100 lowercase letters, digits or hyphens, starting with a letter or a digit`);
  }
  return value;
}

function requireName(body: Body, field: string): string {
  return readName(body, field) ?? refuse(`${field} is required`);
}

/**
 * A text field, or `undefined` when it is not given. A NUL is refused in every one of them, not
 * only in the repo: `execFile` throws on an argument that carries one, and a throw is a 500 where
 * a sentence naming the field is what the person needs.
 */
function readText(body: Body, field: string, fence: TextFence): string | undefined {
  const value = given(body, field);
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return refuse(`${field} must be text`);
  if (value.includes('\0')) return refuse(`${field} must not contain a NUL character`);
  const length = [...value].length;
  if (length < fence.min || length > fence.max || (fence.oneLine && LINE_BREAK.test(value))) {
    return refuse(describeFence(field, fence));
  }
  return value;
}

function requireText(body: Body, field: string, fence: TextFence): string {
  return readText(body, field, fence) ?? refuse(`${field} is required`);
}

/**
 * A goal. The one value refused for what it IS: `-`, which the dispatcher reads as "the goal is on
 * standard input", and this relay feeds its child none. `""` is allowed and is how a goal is cleared.
 */
function readGoal(body: Body): string | undefined {
  const goal = readText(body, 'goal', GOAL_FENCE);
  if (goal === '-') {
    return refuse('goal cannot be a single "-": the dispatcher would read it from standard input, which this relay does not feed');
  }
  return goal;
}

function readRepo(body: Body): string | undefined {
  const repo = readText(body, 'repo', REPO_FENCE);
  if (repo !== undefined && !repo.startsWith('/')) return refuse('repo must be an absolute path');
  return repo;
}

/** `--flag=value` for a free-text value that was given, nothing for one that was not. */
function textFlag(flag: string, value: string | undefined): string[] {
  return value === undefined ? [] : [`${flag}=${value}`];
}

/** `--flag value` for a name that was given: a name cannot begin with a dash, so two words are safe. */
function nameFlag(flag: string, value: string | undefined): string[] {
  return value === undefined ? [] : [flag, value];
}

/** `before` and `after`, which place a new or moved row among its siblings and exclude each other. */
function readPlacement(body: Body): string[] {
  const before = readName(body, 'before');
  const after = readName(body, 'after');
  if (before !== undefined && after !== undefined) return refuse('before and after cannot both be given');
  return [...nameFlag('--before', before), ...nameFlag('--after', after)];
}

/** An add's parent flag, spelled by kind, and the refusals around it: a roadmap takes none, the rest need one. */
function readParent(body: Body, kind: RoadmapKind): string[] {
  const parentOf = PARENT_OF[kind];
  const parent = readName(body, 'parent');
  if (parentOf === null) return parent === undefined ? [] : refuse(`${withArticle(kind)} has no parent`);
  if (parent === undefined) return refuse(`parent is required: the ${parentOf.noun} ${withArticle(kind)} belongs to`);
  return [parentOf.flag, parent];
}

function addArgv(body: Body): string[] {
  const kind = readKind(body, ALL_KINDS);
  const name = readName(body, 'name');
  const parent = readParent(body, kind);
  const title = requireText(body, 'title', TITLE_FENCE);
  const goal = readGoal(body);
  for (const field of ['repo', 'project']) {
    if (!ADD_TAKES[kind].includes(field) && given(body, field) !== undefined) refuse(`${withArticle(kind)} takes no ${field}`);
  }
  const repo = readRepo(body);
  const project = readText(body, 'project', PROJECT_FENCE);
  const placement = readPlacement(body);
  return [
    'roadmap', 'add', kind, ...(name === undefined ? [] : [name]),
    `--title=${title}`, ...textFlag('--goal', goal), ...parent,
    ...textFlag('--repo', repo), ...textFlag('--project', project), ...placement,
  ];
}

function editArgv(body: Body): string[] {
  const kind = readKind(body, ALL_KINDS);
  const name = requireName(body, 'name');
  const changes = [
    ...textFlag('--title', readText(body, 'title', TITLE_FENCE)),
    ...textFlag('--goal', readGoal(body)),
    ...textFlag('--repo', readRepo(body)),
    ...textFlag('--project', readText(body, 'project', PROJECT_FENCE)),
  ];
  if (changes.length === 0) return refuse('edit needs at least one of title, goal, repo or project');
  return ['roadmap', 'edit', kind, name, ...changes];
}

function moveArgv(body: Body): string[] {
  const kind = readKind(body, ALL_KINDS);
  const name = requireName(body, 'name');
  const to = nameFlag('--to', readName(body, 'to'));
  const placement = readPlacement(body);
  const where = [...to, ...placement];
  if (where.length === 0) return refuse('move needs one of to, before or after');
  return ['roadmap', 'move', kind, name, ...where];
}

function blockArgv(body: Body): string[] {
  const kind = readKind(body, BLOCKABLE_KINDS);
  const name = requireName(body, 'name');
  const why = requireText(body, 'why', WHY_FENCE);
  return ['roadmap', 'block', kind, name, `--why=${why}`];
}

function unblockArgv(body: Body): string[] {
  const kind = readKind(body, BLOCKABLE_KINDS);
  return ['roadmap', 'unblock', kind, requireName(body, 'name')];
}

function removeArgv(body: Body): string[] {
  const kind = readKind(body, ALL_KINDS);
  return ['roadmap', 'remove', kind, requireName(body, 'name')];
}

/**
 * One builder per act: the act's argv WITHOUT the actor. `propose` and `unpropose` take a feature's
 * name alone, and `promote` is not a roadmap verb at all but the design door (`dispatcher design`),
 * which is what a promote of an idea has always been.
 */
const ARGV_FOR_ACT: Record<RoadmapAct, (body: Body) => string[]> = {
  add: addArgv,
  edit: editArgv,
  move: moveArgv,
  propose: (body) => ['roadmap', 'propose', requireName(body, 'name')],
  unpropose: (body) => ['roadmap', 'unpropose', requireName(body, 'name')],
  block: blockArgv,
  unblock: unblockArgv,
  remove: removeArgv,
  promote: (body) => ['design', requireName(body, 'name')],
};

/**
 * The argv for one act on one request body, or the 400 sentence naming the field that fails its
 * fence. Pure: it spawns nothing and reads nothing. Never throws for a bad body. Consumer:
 * `roadmap.routes.ts`, which answers the sentence with a 400 and runs the argv through
 * `runDispatcherCommand`.
 */
export function writeArgv(act: RoadmapAct, body: unknown): string[] | string {
  try {
    return [...ARGV_FOR_ACT[act](readBody(body)), ...ACTOR];
  } catch (error) {
    if (error instanceof BodyRefusal) return error.message;
    throw error;
  }
}
