import { sessionsDb } from '@/modules/database/index.js';
import type { DispatcherArc, DispatcherDaemon, DispatcherPlan, DispatcherPlanner, DispatcherRoute } from '@/shared/types.js';

import { arcsOf } from './dispatcher-arc.reader.js';
import { planOf, type DocumentPlan } from './dispatcher-plan.reader.js';
import { plannersOf } from './dispatcher-planner.reader.js';
import { each, field, isCountOrNull, isFlag, isRecord, isText, isTextOrNull, need, oneOf, readDispatcherDocument } from './dispatcher-state.transport.js';

/**
 * The dispatcher's one document, validated into the types the card draws (`server/shared/types.ts`,
 * the DISPATCHER v3 block) and published as this lane's picture.
 *
 * ONE READ, ONE PICTURE. The dispatcher keeps its plans in a SQLite store of its own, so unlike the
 * run lane — which reads a directory of small files and classifies them here — this lane has nothing
 * of its own to derive: `report.py::snapshot` derived the route, the daemon, each plan's word, its
 * phases and their stages at the instant it ran, and nothing of it is stored (INV-172). The server
 * carries that document with exactly three acts of its own, all named in {@link readDispatcherState}.
 *
 * A BODY THAT DOES NOT READ IS NOT A PICTURE, and the strictness is measured rather than stylistic:
 * those run files are written by a process that may be killed mid-write (`state_lock.atomic_write`'s
 * scratch file plus `os.replace`, so a torn `progress.json` is a normal event) while this document is
 * printed whole by a process that has already exited, so a body that does not match is a DIFFERENT
 * BUILD of the dispatcher. Every field is therefore refused BY NAME
 * (`dispatcher-state.transport.ts`), and the throw reaches the lane, which keeps the LAST GOOD
 * picture and says so once per distinct message (`polled-lane.service.ts`). Guessing at a field
 * would put a made-up plan on the operator's screen; a stale one with a line in the journal does not.
 */

/**
 * How long a completed plan stays on the lane, in seconds — the run lane's own number
 * (`plan-runner.module.ts:46`), so the two lanes never disagree about how long a finished thing is
 * shown before the tab leaves it alone. Past this the plan is dropped whether it was dismissed or
 * not: this lane is not an archive.
 */
const ENDED_KEEP_S = 24 * 60 * 60;

/** The two routes this box can walk (`width.route`). */
const PROVIDERS: readonly DispatcherRoute['provider'][] = ['claude', 'deepseek'];

/**
 * The picture this lane polls: the document's own keys and nothing of the frame's.
 *
 * `report.py::snapshot`'s answer, with one key added per plan (`session_app_id`) and two
 * subtractions (a plan completed more than `ENDED_KEEP_S` ago is dropped, and an arc with no plan
 * left on the lane is dropped with it). `offpeak_at` is the next DeepSeek
 * off-peak moment as an ISO stamp — always a string, the literal `none` when that clock cannot
 * answer — and `home` is the store's own root, which is what makes the daemon and the plans on
 * screen knowably one home's.
 *
 * `planners` TRAVELS WHOLE, and is the one list the two subtractions are NOT applied to: an outing
 * names the work it is FOR, and an arc's design is out while that arc's file has not loaded yet — no
 * plan and no arc on this lane answers to its name at all. Dropping it with the plans it does not
 * name would hide exactly the case the badge above the decks exists for, so the whole list goes on
 * the wire and the client decides what has a home to be drawn in.
 *
 * Consumed by `dispatcher-watcher.service.ts` (which wraps it as the `dispatcher_state` frame,
 * adding exactly `kind` and the frame's own `at`) and by `dispatcher.routes.ts` (`GET /plans`). The
 * client never sees this type: it sees the frame.
 */
export type DispatcherPicture = {
  plans: DispatcherPlan[];
  arcs: DispatcherArc[];
  planners: DispatcherPlanner[];
  route: DispatcherRoute;
  daemon: DispatcherDaemon;
  offpeak_at: string;
  home: string;
  generated_at: string;
};

/** What `dispatcher.module.ts` — the one place in this module that reads the environment — hands this reader. */
export type DispatcherStateDependencies = {
  /** The dispatcher's entry point, absolute: `~/.claude/scripts/dispatcher` unless `DISPATCHER_BIN` moved it. */
  bin: string;
  /** Wall-clock ceiling for the one call. A read of a store this size is tens of milliseconds. */
  timeoutMs: number;
  /** The child's environment: `userFacingEnv()` with `PATH` stated — the `systemctl --user` and `systemd-run --user` inside the verbs are looked up on that name, and this server's own unit may have been handed none. */
  env: NodeJS.ProcessEnv;
};

/** The document as it validates — the picture before this server's two acts on it. */
type DocumentPicture = Omit<DispatcherPicture, 'plans'> & { plans: DocumentPlan[] };

/** This box's posture. `word` is the whole posture in one phrase; `ceiling` is the most phases that may walk at once. */
function routeOf(raw: unknown): DispatcherRoute {
  const route = need(raw, isRecord, 'route');
  const swarm = need(field(route, 'swarm'), isRecord, 'route.swarm');
  return {
    provider: oneOf(field(route, 'provider'), PROVIDERS, 'route.provider'),
    swarm: {
      enabled: need(field(swarm, 'enabled'), isFlag, 'route.swarm.enabled'),
      lanes: need(field(swarm, 'lanes'), isCountOrNull, 'route.swarm.lanes'),
    },
    ceiling: need(field(route, 'ceiling'), isCountOrNull, 'route.ceiling'),
    word: need(field(route, 'word'), isText, 'route.word'),
    park_at_peak: need(field(route, 'park_at_peak'), isFlag, 'route.park_at_peak'),
    peak_until: need(field(route, 'peak_until'), isTextOrNull, 'route.peak_until'),
  };
}

/** This home's daemon. `alive` is the LOCK; the pid and the unit are reported only while somebody holds it. */
function daemonOf(raw: unknown): DispatcherDaemon {
  const daemon = need(raw, isRecord, 'daemon');
  return {
    alive: need(field(daemon, 'alive'), isFlag, 'daemon.alive'),
    pid: need(field(daemon, 'pid'), isCountOrNull, 'daemon.pid'),
    unit: need(field(daemon, 'unit'), isTextOrNull, 'daemon.unit'),
  };
}

/** The document, field by field, or a throw naming the field this build could not read. */
function pictureOf(body: unknown): DocumentPicture {
  const document = need(body, isRecord, 'document');
  return {
    plans: each(field(document, 'plans'), 'plans', planOf),
    // Every arc of the store, dropped from the picture only when it would have no card left to head
    // (`arcsOnLane`, below). Read here with the rest of the document so a malformed arc is refused at
    // the same moment a malformed plan is, and never in the middle of a render.
    arcs: arcsOf(field(document, 'arcs')),
    // Every planner outing of the store — the live rows and the stalled endings (the document's own
    // list, `report_planners.entries`). Read here with the rest of the document so a malformed outing
    // is refused at the same moment a malformed plan is, and never in the middle of a render. Absent
    // from a dispatcher build older than the key, which reads as no badges anywhere (`plannersOf`).
    planners: plannersOf(field(document, 'planners')),
    route: routeOf(field(document, 'route')),
    daemon: daemonOf(field(document, 'daemon')),
    offpeak_at: need(field(document, 'offpeak_at'), isText, 'offpeak_at'),
    home: need(field(document, 'home'), isText, 'home'),
    generated_at: need(field(document, 'generated_at'), isText, 'generated_at'),
  };
}

/**
 * Whether a completed plan is still worth showing.
 *
 * A stamp that does not parse is KEPT rather than dropped: the conservative direction is the one the
 * run lane takes with a file it cannot classify, and a plan shown wrongly is a smaller fault than a
 * plan that silently vanished.
 */
function isRecent(plan: DocumentPlan, nowS: number): boolean {
  if (plan.completed_at === null) return true;
  const completedS = Date.parse(plan.completed_at) / 1000;
  return !Number.isFinite(completedS) || completedS > nowS - ENDED_KEEP_S;
}

/** The plan's launching session as an app id — `null` when it names none, and resolved through the one rule the run lane uses (the raw uuid never crosses the wire). */
function withAppSession(plan: DocumentPlan): DispatcherPlan {
  return {
    ...plan,
    session_app_id: plan.session === null ? null : sessionsDb.resolveAppSessionId(plan.session),
  };
}

/**
 * The arcs worth carrying: the ones with at least one plan STILL ON THE LANE.
 *
 * An arc header is drawn over its plans, and the plan filter above drops the ones that ended long
 * ago — so an arc every one of whose plans has been dropped would leave a header standing over
 * nothing, forever, since nothing about it changes. This server's third act on the document, and the
 * same act the plan filter makes: a thing with no card left is not a thing to draw.
 *
 * It is asked against the names the LANE kept, never against the arc's own list, so the two halves
 * of the picture cannot disagree about what is on screen — the join `plan.arc` makes on the client
 * is the same one, read from the other side.
 */
function arcsOnLane(arcs: DispatcherArc[], plans: DispatcherPlan[]): DispatcherArc[] {
  const carried = new Set(plans.map((plan) => plan.name));
  return arcs.filter((arc) => arc.plans.some((name) => carried.has(name)));
}

/**
 * One read of the dispatcher's document, as the picture this lane serves.
 *
 * Called every two seconds by the watcher and, through it, by `GET /plans`. It THROWS on anything it
 * cannot read — this file's head says why that is the honest answer — and the lane keeps the last
 * good picture when it does.
 *
 * This server's three acts on the document, and the only three: a plan completed more than
 * `ENDED_KEEP_S` ago is dropped, each remaining plan's `session` is resolved to an app id, and an arc
 * with no plan left on the lane is dropped with them. Every other key travels exactly as `report.py`
 * printed it.
 */
export async function readDispatcherState(dependencies: DispatcherStateDependencies): Promise<DispatcherPicture> {
  const document = pictureOf(await readDispatcherDocument(dependencies.bin, dependencies.timeoutMs, dependencies.env));
  const nowS = Date.now() / 1000;
  const plans = document.plans.filter((plan) => isRecent(plan, nowS)).map(withAppSession);
  return {
    plans,
    arcs: arcsOnLane(document.arcs, plans),
    planners: document.planners,
    route: document.route,
    daemon: document.daemon,
    offpeak_at: document.offpeak_at,
    home: document.home,
    generated_at: document.generated_at,
  };
}
