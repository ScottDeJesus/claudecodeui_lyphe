import express from 'express';

import type { DispatcherOffpeak, DispatcherVerb, DispatcherVerbResult, DispatcherWipChoice, DispatcherWipLimit } from '@/shared/types.js';
import {
  dispatcherModelChoiceError,
  dispatcherScheduleWhenError,
  readDispatcherModelChoice,
  readDispatcherScheduleWhen,
  readDispatcherWipWord,
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

/** The two limits an epic carries, in the dispatcher's own spelling (`hooks/dispatcher/wip.py:KINDS`) — the only `limit` words the WIP route relays. */
const WIP_LIMITS: readonly DispatcherWipLimit[] = ['features', 'tasks'];

/** The 400 sentence the WIP route answers with when the body names no limit and word the dispatcher takes. */
const WIP_BODY_ERROR = 'limit must be features or tasks, and word a whole number from 1 to 9007199254740991, all, or default';

/**
 * The argv words of an epic's WIP press — `[limit, word]` after the arc's name — or `null` for a body
 * the dispatcher's `wip` verb would refuse.
 *
 * BOTH WORDS ARE OURS ONCE THEY ARE HERE, and checked BEFORE ANY PROCESS STARTS: the limit against the
 * dispatcher's two, the word against its grammar (`readDispatcherWipWord`: a canonical count to
 * 9007199254740991, or `all`) plus the door's own `default`. The count is bounded because the word
 * travels back to the screen in `status --json`, and a count its reader refuses would freeze the whole
 * Runner board's picture (INV-5693) — the bound is enforced where the word enters, not discovered
 * where it is read. What reaches an argv array is a spelling this server wrote, never a string the
 * request chose.
 */
function wipArgs(body: unknown): string[] | null {
  const { limit, word } = (body ?? {}) as { limit?: unknown; word?: unknown };
  const checkedLimit = WIP_LIMITS.find((entry) => entry === limit);
  const checkedWord: DispatcherWipChoice | null = word === 'default'
    ? 'default'
    : (readDispatcherWipWord(word) as DispatcherWipChoice | null);
  return checkedLimit === undefined || checkedWord === null ? null : [checkedLimit, checkedWord];
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
 * The dispatcher lane's twenty routes: three reads of the plan list, ten presses on a plan, seven on
 * an arc. Auth is the mount's `authenticateToken`, in `server/index.ts`.
 *
 * These handlers validate and translate, and do nothing else: nothing is read here, no process is
 * started here, and no route names a path from the request — the binary and the store are the
 * module's, fixed at composition, and a request can only ever choose a plan or an arc by name, a
 * word from the closed set of eleven verbs, and — where the verb takes one — a word from the three
 * model words or the WIP grammar.
 *
 * A READ THAT FINDS NO PICTURE IS TOLD SO (`NOT_READ_YET` above), and the read waits a bound for one
 * first: the two together are what keep a handover from being drawn as an empty plan list.
 *
 * FOUR OF THE NINE ARE RELAYED TWICE, once under `/plans/:name` and once under `/arcs/:name`, because
 * the dispatcher's own doors open on both: `model`, `stop`, `resume` and `schedule` take an arc's
 * name as readily as a plan's. The two spellings are two routes rather than one param because the
 * NAME CLASSES differ (`PLAN_NAME` against `ARC_NAME` below) — a fence that would be lost the moment
 * one route accepted either adornment. `wip` is the ninth and an ARC'S ALONE: a feature carries no WIP
 * word, so it has no plan route.
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
  // time a queued plan's `Start at …` button shows: the dispatcher's own clock, never computed here.
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
   * A model word, out of the three the store spells (`readDispatcherModelChoice`), or `null`.
   *
   * The word is OURS ONCE IT IS HERE: it is checked against the store's own three by the shared
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
  // needs no branch for it: `DROPPED <name>` is a 200, and the dispatcher's two refusals — `REFUSED
  // drop …` while a phase walks or a planner outing for the plan or its arc is live (exit 2), and
  // `no plan <name>` (exit 1) — are each a 409 whose body is that sentence, untouched.
  router.post('/plans/:name/drop', relay('drop'));
  // A plan's STALLED planner outing put back to work (`dispatcher planner-resume <plan> --by app:card`) —
  // the card's `Resume planner`. THE DISPATCHER CHOOSES THE DOOR, from its own store at the press: a cut
  // goes back through `cut`, a judgment through `judge`, a design or a tell through a `tell` of
  // `continue`, so this route carries no verb of the outing's and no body, and a plan with nothing
  // stalled is the dispatcher's own refusal (`REFUSED planner-resume …`, a 409). `--by app:card` is the
  // press's actor, written to the plan's log the way an Accept's is; the word is ours, never the request's.
  router.post('/plans/:name/planner-resume', relay('planner-resume', () => ['--by', 'app:card']));
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
  // A QUEUED plan's Start at a time, and the only verb here with an argument:
  // `dispatcher schedule <name> offpeak|<iso>|none`. The dispatcher refuses a plan that is live or
  // has never waited, and a time already past; that sentence is the 409's body, untouched.
  router.post('/plans/:name/schedule', relay('schedule', (body) => {
    const when = readDispatcherScheduleWhen((body as { when?: unknown } | undefined)?.when);
    return when === null ? null : [when];
  }));

  /**
   * The ARC's five verbs — `model`, `stop`, `resume`, `schedule`, `wip` — relayed to the arc's own door.
   *
   * AN ARC IS ADDRESSED BY ITS OWN NAME, and the dispatcher is what resolves it. Each of these four
   * verbs takes a plan's name OR an arc's and answers an arc's name with the PLAN verb applied to
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
   * for `schedule` it arms one hour for each of them (INV-201 knows no arc-level timer). The next
   * frame redraws the arc's header and its plans together — nothing here is optimistic, and nothing
   * is copied by this server.
   *
   * `wip` IS THE ARC'S ALONE: `dispatcher wip <arc> features|tasks <N|all|default>` sets one of the
   * epic's two limits (or hands it back to Settings' default), never refused for the epic's state —
   * the limit is read at the rule's next take-up (`width.reason`), and the dispatcher kicks its own
   * daemon when the word changed, so a wider limit frees a held feature without another press.
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
  router.post('/arcs/:name/resume', arcRelay('resume'));
  // The arc's Start at a time — the row's `Schedule start`: the same three shapes a plan's schedule
  // takes, through the same reader, so an operator who can name an hour for one plan can name it for
  // a whole arc. One timer per stopped plan, and a stopped plan is one at the gate as readily as one
  // down mid-walk (`report_arcs.stopped`).
  router.post('/arcs/:name/schedule', arcRelay('schedule', (body) => {
    const when = readDispatcherScheduleWhen((body as { when?: unknown } | undefined)?.when);
    return when === null ? null : [when];
  }));
  // The deck's `Accept when cut` and its Cancel: the dispatcher arms every DESIGNED plan of the arc on that plan's
  // own current design, so no stamp travels — the card never read the members' designs one by one.
  router.post('/arcs/:name/arm-accept', arcRelay('arm-accept', () => ['--by', 'app:card']));
  router.post('/arcs/:name/disarm-accept', arcRelay('disarm-accept'));
  // One of the epic's two WIP limits (`dispatcher wip <arc> <limit> <word>`): the epic card's WIP control.
  router.post('/arcs/:name/wip', arcRelay('wip', wipArgs, WIP_BODY_ERROR));

  return router;
}
