import express from 'express';

import type { DispatcherOffpeak, DispatcherVerb, DispatcherVerbResult } from '@/shared/types.js';
import {
  dispatcherModelChoiceError,
  dispatcherScheduleWhenError,
  readDispatcherModelChoice,
  readDispatcherScheduleWhen,
} from '@/shared/utils.js';

import type { DispatcherPicture } from './dispatcher-state.service.js';

/**
 * What a plan may be called in a URL.
 *
 * The dispatcher's own name rule (`hooks/dispatcher/store.py:NAME_RE` — a bare, lowercase,
 * hyphenated name, minted by the board). It is written out rather than imported because the rule's
 * HOME is that module, on the other side of a process boundary; what this fence is for is narrower
 * and worth stating exactly: an argument that cannot be parsed as a plan name never reaches an argv
 * array at all. Everything the regex refuses — a slash, a space, a `$`, a leading `.` — is a string
 * no verb could act on, and refusing it here is what keeps any future caller of this router from
 * having to remember that.
 */
const PLAN_NAME = /^[a-z0-9][a-z0-9-]{0,99}$/;

/**
 * What an ARC may be called in a URL: the same name class with the arc's own adornment
 * (`store_arcs.ARC_SUFFIX` — `.arc`), which is the form `report_arcs.arc_line` prints and
 * `store.arc` accepts.
 *
 * A SEPARATE FENCE FROM THE PLAN'S (`PLAN_NAME`), and the same fence in kind: this route answers
 * `<name>` or `<name>.arc`, that one the bare name alone and refuses the `.arc` ending.
 */
const ARC_NAME = /^[a-z0-9][a-z0-9-]{0,99}(\.arc)?$/;

/** The 400 sentence the queue route answers with when the body is not exactly one of the three moves the dispatcher's `queue` verb takes. */
const QUEUE_BODY_ERROR = 'body must be exactly one of { "before": <epic name> }, { "last": true } or { "at": <whole number from 1 to 9999> }';

/** The largest place `{ "at": N }` may name: past the end of the queue the dispatcher reads it as last, so the bound only keeps the argv word a short number. */
const QUEUE_AT_MAX = 9999;

/**
 * The argv words of an epic's move in the queue — `['--before', <epic>]`, `['--last']` or `['--at', <N>]`
 * after the arc's name — or `null` for a body that is not EXACTLY one of the three, checked BEFORE ANY
 * PROCESS STARTS. The `before` name goes through the same fence as the URL's (`ARC_NAME`); `at` must be
 * a whole number from 1 to `QUEUE_AT_MAX`; `last` must be `true`. What reaches an argv array is a
 * spelling this server wrote, never a string the request chose.
 */
function queueArgs(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const move = body as { before?: unknown; last?: unknown; at?: unknown };
  if (Object.keys(move).length !== 1) return null;
  if (typeof move.before === 'string' && ARC_NAME.test(move.before)) return ['--before', move.before];
  if (move.last === true) return ['--last'];
  if (typeof move.at === 'number' && Number.isInteger(move.at) && move.at >= 1 && move.at <= QUEUE_AT_MAX) return ['--at', String(move.at)];
  return null;
}

/** The seven words the epic dial takes (`hooks/dispatcher/epic_dial.py:WORDS`): a limit of `1` to `5`, and the pause. The only `word` values the epics route relays. */
const EPIC_WORDS: readonly string[] = ['pause', 'resume'];

/** The 400 sentence the epics route answers with when the body names neither word. */
const EPICS_BODY_ERROR = 'word must be one of pause or resume';

/** The 400 sentence the start route answers with when a body names anything: the board's Start takes none. */
const START_BODY_ERROR = 'the board\'s Start takes no body';

/** The most names one Hide or Show may carry: a board holds a few hundred plans at most, and the bound only keeps the argv short. */
const HIDE_NAMES_MAX = 200;

/** The 400 sentence the hide and unhide routes answer with when the body is not exactly a list of plan or epic names. */
const HIDE_BODY_ERROR = `body must be exactly { "names": [<plan or epic name>, …] }, one to ${HIDE_NAMES_MAX} names`;

/**
 * The argv words of a Hide or a Show — the plan and epic names after the verb — or `null` for a body that is
 * not EXACTLY `{ "names": [...] }` with one to `HIDE_NAMES_MAX` names, each through the arc fence (`ARC_NAME`:
 * a plan's bare name or an epic's, with or without `.arc`; the dispatcher resolves which). Checked BEFORE ANY
 * PROCESS STARTS, so what reaches an argv array is a spelling this server wrote down, never a string the
 * request chose.
 */
function hideArgs(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { names } = body as { names?: unknown };
  if (Object.keys(body).length !== 1 || !Array.isArray(names) || names.length < 1 || names.length > HIDE_NAMES_MAX) return null;
  return names.every((name): name is string => typeof name === 'string' && ARC_NAME.test(name)) ? [...names] : null;
}

/** A design's stamp (`designs.loaded_at`, `store.now()`'s shape): the lock an "Accept when cut" press carries. */
const DESIGN_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** The 400 sentence the arm route answers with when the body carries no design stamp. */
const DESIGN_STAMP_ERROR = 'design must be the design stamp the card read (YYYY-MM-DDTHH:MM:SSZ)';

/**
 * The argv words of a card's "Accept when cut" press — `['--by', 'app:card', '--design', <stamp>]` — or
 * `null` for a body that carries no stamp of the design's shape, checked BEFORE ANY PROCESS STARTS.
 *
 * THE STAMP IS THE LOCK: the press binds to the exact design the operator read, and the dispatcher
 * refuses one whose design has since moved. `--by` is this server's own word — the press is the
 * operator's, from the card or the phone (the same card), and a request can neither pick the door nor
 * leave the stamp out to press on whatever the design is by then.
 */
function armAcceptArgs(body: unknown): string[] | null {
  const { design } = (body ?? {}) as { design?: unknown };
  return typeof design === 'string' && DESIGN_STAMP.test(design) ? ['--by', 'app:card', '--design', design] : null;
}

export type DispatcherRouterDependencies = {
  /**
   * The reading to answer a request with: the watcher's last, and — in the gap before this boot's
   * first `dispatcher status --json` has landed — that first reading, waited for up to the bound the
   * composition root names (`FIRST_READ_WAIT_MS`, `dispatcher.module.ts`). Never a fresh read of its
   * own: the poll already owns the subprocess.
   *
   * `null` means the wait ended with this boot still holding no picture, and the routes below answer
   * that with `NOT_READ_YET` — never with an empty plan list, which every client downstream would
   * publish as a reading.
   */
  current: () => Promise<DispatcherPicture | null>;
  /** Relays one of the dispatcher's own verbs and comes back with what it said; `verbArgs` follow the plan's name. */
  runVerb: (verb: DispatcherVerb, plan: string, verbArgs?: readonly string[]) => Promise<DispatcherVerbResult>;
  /** The dispatcher's next DeepSeek off-peak moment, epoch SECONDS or `null` (`dispatcher-offpeak.service.ts`). */
  offpeak: () => Promise<number | null>;
};

/**
 * What a read is told while this boot has not read the dispatcher yet.
 *
 * Never an empty picture, and never an error status. "No plans" is a CLAIM about the host, and this
 * server may only make it after reading the store; before that, the one true thing to say is that
 * there is nothing to say yet. 200, not 503: a read with nothing to say yet is not a fault, and a
 * non-2xx status is what puts a console error in every tab that seeds while a handover is still
 * reading (the rule `accounts.routes.ts` states for its reads). The body is what keeps this from
 * being drawn — not the whole picture, so `DispatcherFeed`'s `asPicture` answers `null` for it and
 * publishes nothing — and the frame the first landing broadcasts fills the tab a moment later. The
 * reader sees the plans arrive, instead of watching them drop to zero and climb back.
 */
const NOT_READ_YET = { error: 'the dispatcher has not been read yet' } as const;

/**
 * How a relayed verb's outcome becomes a status.
 *
 * A dispatcher refusal is a CONFLICT, not a server fault — the plan is not in a state that verb can
 * act on (`REFUSED schedule <name>: is live — stop it first`, exit 2), the dispatcher said exactly
 * why on stdout, and that sentence travels in the body untouched. Turning it into a 500 would replace
 * the one useful thing in the answer with our own paraphrase.
 */
function statusForVerb(result: DispatcherVerbResult): number {
  if (result.ok) return 200;
  if (result.reason === 'timeout') return 504;
  if (result.reason === 'spawn-failed') return 503;
  return 409;
}

/**
 * The dispatcher lane's twenty-five routes: three reads of the plan list, twelve presses on a plan, six on
 * an arc, four on the board. Auth is the mount's `authenticateToken`, in `server/index.ts`.
 *
 * These handlers validate and translate, and do nothing else: nothing is read here, no process is
 * started here, and no route names a path from the request — the binary and the store are the
 * module's, fixed at composition, and a request can only ever choose a plan or an arc by name, a
 * word from the closed set of sixteen verbs, and — where the verb takes one — a word from the three
 * model words, the queue's three moves or the epic dial's seven words.
 *
 * A READ THAT FINDS NO PICTURE IS TOLD SO (`NOT_READ_YET` above), and the read waits a bound for one
 * first: the two together are what keep a handover from being drawn as an empty plan list.
 *
 * FIVE OF THE SIXTEEN ARE RELAYED TWICE, once under `/plans/:name` and once under `/arcs/:name`, because
 * the dispatcher's own doors open on both: `model`, `stop`, `resume` and the `arm-accept` /
 * `disarm-accept` pair take an arc's name as readily as a plan's. The two spellings are two routes
 * rather than one param because the NAME CLASSES differ (`PLAN_NAME` against `ARC_NAME` below) — a
 * fence that would be lost the moment one route accepted either adornment. `schedule` is a PLAN'S alone
 * here (the card's `Resume at …`): the deck's `Schedule start` is gone, though the terminal's
 * `dispatcher schedule <arc>` stays. `queue` is the ARC'S ALONE: a feature holds no place in a queue of
 * epics, so it has no plan route. `epics` `start`, `hide` and
 * `unhide` are the BOARD'S: the dial and the one Start name no plan and no arc, and Hide and Show carry any
 * number of plan and epic names in their body (one route each, because one press may carry the whole
 * Hidden list), so they are the routes with no `:name`, and their answers carry `plan: ""`.
 */
export function createDispatcherRouter(dependencies: DispatcherRouterDependencies): express.Router {
  const router = express.Router();

  router.get('/plans', async (_request, response) => {
    const picture = await dependencies.current();
    if (picture === null) {
      response.json(NOT_READ_YET);
      return;
    }
    response.json({ ...picture, at: Date.now() });
  });

  // BEFORE `/plans/:name`, which would otherwise answer `no such plan` for the word `offpeak`. The
  // time a stopped plan's `Resume at …` button shows: the dispatcher's own clock, never computed here.
  router.get('/plans/offpeak', async (_request, response) => {
    const body: DispatcherOffpeak = { at: await dependencies.offpeak() };
    response.json(body);
  });

  router.get('/plans/:name', async (request, response) => {
    const picture = await dependencies.current();
    if (picture === null) {
      response.json(NOT_READ_YET);
      return;
    }
    // The bare name, which is the only spelling there is: the store holds it, the document prints it,
    // and the card and every verb address a plan by it. No name is ever rewritten here.
    const wanted = request.params.name;
    const plan = picture.plans.find((entry) => entry.name === wanted);
    if (!plan) {
      response.status(404).json({ error: 'no such plan' });
      return;
    }
    response.json({ plan });
  });

  /**
   * Every verb is the same handler; only the word differs, and the word is ours, never the request's
   * — `schedule`'s hour too, checked by `readDispatcherScheduleWhen` against the three shapes the
   * dispatcher accepts, so the argv word is always one we wrote down. `readArgs` answers `null` for a
   * body that names nothing the dispatcher accepts (a 400 with `badBody`'s sentence, nothing
   * spawned). The params are declared rather than left to the default dictionary, whose `name` is
   * `string | string[]` for the repeated-parameter patterns these routes do not use.
   *
   * The plan's name travels to the dispatcher EXACTLY as the URL spelled it — the bare name, which
   * is what the dispatcher's own door takes. This route's job is to refuse what cannot be a name,
   * never to normalize one.
   */
  const relay = (
    verb: DispatcherVerb,
    readArgs: (body: unknown) => string[] | null = () => [],
    badBody: string = dispatcherScheduleWhenError(),
  ): express.RequestHandler<{ name: string }> => async (request, response, next) => {
    const plan = request.params.name;
    if (!PLAN_NAME.test(plan)) {
      response.status(400).json({ error: 'plan name is required' });
      return;
    }
    const verbArgs = readArgs(request.body);
    if (verbArgs === null) {
      response.status(400).json({ error: badBody });
      return;
    }

    try {
      const result = await dependencies.runVerb(verb, plan, verbArgs);
      response.status(statusForVerb(result)).json(result);
    } catch (error) {
      // The service resolves every failure it can name, so reaching here means something this lane
      // has no word for. It belongs to the app's error handler, not to a body of our own.
      next(error);
    }
  };

  /**
   * A model word, out of the three the door spells (`readDispatcherModelChoice`: the two words and
   * `default`, which clears the row), or `null`.
   *
   * The word is OURS ONCE IT IS HERE: it is checked against the door's own three by the shared
   * reader, and only then does it become an argv word — so what reaches the dispatcher's command is
   * a spelling this server wrote down, never a string a request chose.
   */
  const modelArgs = (body: unknown): string[] | null => {
    const choice = readDispatcherModelChoice((body as { model?: unknown } | undefined)?.model);
    return choice === null ? null : [choice];
  };

  router.post('/plans/:name/stop', relay('stop'));
  router.post('/plans/:name/resume', relay('resume'));
  router.post('/plans/:name/park', relay('park'));
  router.post('/plans/:name/unpark', relay('unpark'));
  // A plan taken out of the store for good (`dispatcher drop <name>`) — the one press no other press
  // undoes, and a plan's alone: no arc door opens on it. No body and no argument. `statusForVerb`
  // needs no branch for it: `DROPPED <name>` is a 200 — and so is `DROPPED <name> — withdrew its queued
  // <soul> <verb>`, the plan's own outing still waiting in the queue going with it — and the
  // dispatcher's two refusals — `REFUSED drop …` while a phase walks or a planner outing for the plan or
  // its arc is live and not that (exit 2), and `no plan <name>` (exit 1) — are each a 409 whose body is
  // that sentence, untouched.
  router.post('/plans/:name/drop', relay('drop'));
  // A plan's STALLED planner outing put back to work (`dispatcher planner-resume <plan> --by app:card`) —
  // the card's `Resume planner`. THE DISPATCHER CHOOSES THE DOOR, from its own store at the press: a cut
  // goes back through `cut`, a judgment through `judge`, a design or a tell through a `tell` of
  // `continue`, so this route carries no verb of the outing's and no body, and a plan with nothing
  // stalled is the dispatcher's own refusal (`REFUSED planner-resume …`, a 409). `--by app:card` is the
  // press's actor, written to the plan's log the way an Accept's is; the word is ours, never the request's.
  router.post('/plans/:name/planner-resume', relay('planner-resume', () => ['--by', 'app:card']));
  // The operator's lift of the usage pacer's hold for THIS plan (`dispatcher override <plan> --by app:card`) —
  // the card's `Override` — and its undo (`… --off --by app:card`, `Turn off`). It lifts the pacer and nothing
  // else: the plan's model word, its epic's and the house switch are untouched, and every soul rides the
  // route that switch gives it. THE DISPATCHER REFUSES THE LIFT INSIDE A CLAUDE SESSION, and this lane's
  // child environment carries none (`laneEnv`), so the card's press is the operator's own. The two words
  // are ours (`--by app:card` names the press's door in the plan's log); no body and no argument travel.
  // A refusal (`REFUSED override …`: a finished plan, one the roadmap still holds, one already past the
  // pacer, or `--off` on a plan that carries none) is a 409 whose body is that sentence, untouched.
  router.post('/plans/:name/override', relay('override', () => ['--by', 'app:card']));
  router.post('/plans/:name/override-off', relay('override', () => ['--off', '--by', 'app:card']));
  // A DESIGNED plan Accepted ahead of its cut (`dispatcher arm-accept <name> --by app:card --design <stamp>`) —
  // the card's `Accept when cut`: the daemon approves the first cut of that exact design and walks it. The
  // stamp the card drew travels in the body and is checked before any spawn (`armAcceptArgs`); the dispatcher
  // refuses a press on a design that has since moved (a 409 carrying its own sentence) and answers a second
  // press with exit 3 (`already armed`), which the card reads as answered. A model never arms: the verb refuses
  // inside a Claude session, and this server strips that variable from the command's environment.
  router.post('/plans/:name/arm-accept', relay('arm-accept', armAcceptArgs, DESIGN_STAMP_ERROR));
  // Its Cancel (`dispatcher disarm-accept <name>`): no body, no argument.
  router.post('/plans/:name/disarm-accept', relay('disarm-accept'));
  // A plan's own DeepSeek / Claude word (`dispatcher model <name> <word>`). RESTARTS NOTHING AND
  // WAKES NOBODY: the word is read when a chain is launched (`phase_chain.launch_env`), so it takes
  // the plan's NEXT phase and never disturbs a walk already out — which is why no plan's state is a
  // reason to refuse this verb, and why the dispatcher's own answer is the whole verdict.
  router.post('/plans/:name/model', relay('model', modelArgs, dispatcherModelChoiceError()));
  // A STOPPED plan's Resume at a time (the card's `Resume at …`, and its Cancel), and the only verb here
  // with an argument: `dispatcher schedule <name> offpeak|<iso>|none`. The dispatcher refuses a plan that
  // is live or has never waited, and a time already past; that sentence is the 409's body, untouched.
  router.post('/plans/:name/schedule', relay('schedule', (body) => {
    const when = readDispatcherScheduleWhen((body as { when?: unknown } | undefined)?.when);
    return when === null ? null : [when];
  }));

  /**
   * The ARC's six verbs — `model`, `stop`, `resume`, `arm-accept`, `disarm-accept` and `queue` —
   * relayed to the arc's own door.
   *
   * AN ARC IS ADDRESSED BY ITS OWN NAME, and the dispatcher is what resolves it. Each of the five
   * verbs a plan's door shares (`model`, `stop`, `resume`, `arm-accept`, `disarm-accept`) takes a
   * plan's name OR an arc's and answers an arc's name with the PLAN verb applied to
   * the arc's plans in one step (`hooks/dispatcher/arc_verbs.py` holds which plans and why) — so the
   * plan-first-then-arc resolution is deliberately not repeated here: this route names an arc, the
   * name it forwards carries the arc's own adornment, and the dispatcher decides the rest. Which is
   * the whole point of routing it this way rather than looping over the arc's plans on this side: the
   * terminal and the card say the same thing because they say it with the same verb.
   *
   * For `model` the dispatcher hands the word to EVERY plan of the arc (`store.set_arc_model`); for
   * `stop` and `resume` it moves the arc's live, or its stopped, plans in one transaction and one
   * kick — a stopped plan being any plan of the arc that is approved, paused and unfinished, whether
   * it waits at the gate or was stopped mid-walk, which is what makes `resume <arc>` the arc's Start;
   * The next frame redraws the arc's header and its plans together — nothing here is optimistic, and nothing
   * is copied by this server.
   *
   * `queue` IS THE ARC'S ALONE: `dispatcher queue <arc> --before <arc> | --last | --at N` moves the
   * epic in the order In flight runs them top down, and the dispatcher refuses an epic that is not in
   * the queue (`REFUSED queue …`, a 409 carrying that sentence). The body is one of three moves,
   * checked here before any process starts (`queueArgs`); the order itself is the dispatcher's store's.
   *
   * The same two fences as the plan routes, one name class over: the arc's own regex, and a verb word
   * that is OURS — never the request's.
   */
  const arcRelay = (
    verb: DispatcherVerb,
    readArgs: (body: unknown) => string[] | null = () => [],
    badBody: string = dispatcherScheduleWhenError(),
  ): express.RequestHandler<{ name: string }> => async (request, response, next) => {
    const arc = request.params.name;
    if (!ARC_NAME.test(arc)) {
      response.status(400).json({ error: 'arc name is required' });
      return;
    }
    const verbArgs = readArgs(request.body);
    if (verbArgs === null) {
      response.status(400).json({ error: badBody });
      return;
    }

    try {
      const result = await dependencies.runVerb(verb, arc, verbArgs);
      response.status(statusForVerb(result)).json(result);
    } catch (error) {
      next(error); // one this lane has no word for: the app's error handler, as every route here
    }
  };

  router.post('/arcs/:name/model', arcRelay('model', modelArgs, dispatcherModelChoiceError()));
  router.post('/arcs/:name/stop', arcRelay('stop'));
  // The deck's Resume (`dispatcher resume <arc>`): its plans stopped mid-walk and its stalled ones, as the
  // operator's own press on the epic. The plans held for their first Start are the board's Start's, below.
  router.post('/arcs/:name/resume', arcRelay('resume'));
  // The deck's `Accept when cut` and its Cancel: the dispatcher arms every DESIGNED plan of the arc on that plan's
  // own current design, so no stamp travels — the card never read the members' designs one by one.
  router.post('/arcs/:name/arm-accept', arcRelay('arm-accept', () => ['--by', 'app:card']));
  router.post('/arcs/:name/disarm-accept', arcRelay('disarm-accept'));
  // An epic moved in the queue (`dispatcher queue <arc> --before <arc> | --last | --at N`): In flight's drag.
  router.post('/arcs/:name/queue', arcRelay('queue', queueArgs, QUEUE_BODY_ERROR));

  // The epic dial's one word (`dispatcher epics <pause|resume>`): a BOARD verb, so it names
  // no plan and no arc and the name the relay is handed is empty (`runDispatcherVerb` leaves it out of the argv).
  // THE BODY IS EXACTLY `{ "word": … }`, as the queue's is exactly one move: a body carrying another key is
  // not one this route knows, and is a 400 like any other.
  router.post('/epics', async (request, response, next) => {
    const body = request.body as { word?: unknown } | null | undefined;
    const word = typeof body === 'object' && body !== null && !Array.isArray(body) && Object.keys(body).length === 1
      ? EPIC_WORDS.find((entry) => entry === body.word)
      : undefined;
    if (word === undefined) {
      response.status(400).json({ error: EPICS_BODY_ERROR });
      return;
    }
    try {
      const result = await dependencies.runVerb('epics', '', [word]);
      response.status(statusForVerb(result)).json(result);
    } catch (error) {
      next(error); // one this lane has no word for: the app's error handler, as every route here
    }
  });

  // THE BOARD'S ONE START (`dispatcher start`): every plan held for its first Start let go at once, the
  // queue's order and the dial then deciding what runs. A BOARD verb like `epics` — no plan, no arc, an
  // empty name the relay leaves out of the argv — and it takes NO body at all: there is nothing to say
  // but "start", so any key a request carries is a 400, as the epics route's extra keys are. The
  // dispatcher answers `STARTED <k> plan(s)`, or `REFUSED start: …` (a 409) when nothing waits.
  router.post('/start', async (request, response, next) => {
    const body = request.body as Record<string, unknown> | null | undefined;
    if (typeof body === 'object' && body !== null && !Array.isArray(body) && Object.keys(body).length > 0) {
      response.status(400).json({ error: START_BODY_ERROR });
      return;
    }
    try {
      const result = await dependencies.runVerb('start', '', []);
      response.status(statusForVerb(result)).json(result);
    } catch (error) {
      next(error); // one this lane has no word for: the app's error handler, as every route here
    }
  });

  // HIDE AND SHOW (`dispatcher hide <name>…`, `dispatcher unhide <name>…`): the operator's hold on a plan
  // and the way back. A BOARD verb pair like `epics` and `start` — the names travel in the body, plans'
  // and epics' alike, because the dispatcher resolves each (plan first, then epic) and an epic's name
  // hides every open plan of it — so the relay is handed the empty name and the argv is exactly
  // `["hide", name, …]`. The dispatcher answers `HIDDEN <name>` / `SHOWN <name>` per name, or a
  // `REFUSED hide|unhide …` (a 409 carrying that sentence, nothing written) — a finished plan, a plan that
  // is not hidden.
  for (const verb of ['hide', 'unhide'] as const) {
    router.post(`/${verb}`, async (request, response, next) => {
      const names = hideArgs(request.body);
      if (names === null) {
        response.status(400).json({ error: HIDE_BODY_ERROR });
        return;
      }
      try {
        const result = await dependencies.runVerb(verb, '', names);
        response.status(statusForVerb(result)).json(result);
      } catch (error) {
        next(error); // one this lane has no word for: the app's error handler, as every route here
      }
    });
  }

  return router;
}
