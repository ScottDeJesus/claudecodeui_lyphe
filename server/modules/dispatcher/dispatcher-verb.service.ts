import { runDispatcherCommand, type DispatcherCommandDependencies } from '@/shared/dispatcher-command.js';
import type { DispatcherVerb, DispatcherVerbResult } from '@/shared/types.js';

/**
 * Relaying the dispatcher's own nine verbs: `stop`, `resume`, `schedule` (a plan's Start — or its
 * Resume, for one already stopped — at a time), `park` (a designed plan set aside), `unpark` (handed
 * back to be cut), `model` (a plan's or an arc's own DeepSeek / Claude word), `swarm` (a plan's own
 * swarm word), `drop` (a plan removed, with everything the store holds of it — refused while a phase
 * of it walks or while a planner outing for the plan or its arc is live, the two gates of
 * `hooks/dispatcher/cmd/drop.py`) and `planner-resume` (a plan's stalled planner outing put back to
 * work — which door it goes back through is the dispatcher's own reading of its store, so it takes
 * the press's `--by` and nothing else).
 *
 * FOUR OF THE NINE NAME AN ARC AS READILY AS A PLAN — `stop`, `resume`, `schedule` and `model`, each
 * resolved by the dispatcher's own door and by nothing on this side. An arc has no walk of its own:
 * `stop <arc>` is this same verb over the arc's LIVE plans — what is walking and what is approved,
 * unpaused and waiting its turn — and `resume <arc>` over its STOPPED ones, which is every plan of it
 * that is approved, paused and unfinished: queued at the gate as much as stopped mid-walk. One
 * transaction and one kick, and the order the plans then walk in is the daemon's own (`rule.eligible`
 * keeps it). `schedule <arc>` arms the operator's one hour for each of those stopped plans (INV-201
 * knows no arc-level timer). `park`, `unpark` and `drop` are the plan card's own and no arc header
 * draws them.
 *
 * This server never touches a plan. It does not hold the dispatcher's lock, does not signal its
 * daemon and never writes the store (`hooks/dispatcher/store.py`, which no server writer may reach —
 * INV-170). It runs the dispatcher's own command and carries back what the dispatcher said. That is
 * the whole design: the dispatcher already knows what a refusal means, which plans may be paused at
 * all, and whether an hour can be armed for this one.
 *
 * The subprocess, the argv boundary and what a refusal looks like are `@/shared/dispatcher-command.ts`'s
 * (`runDispatcherCommand`): a refusal travels whole in `stdout`, and this file adds only the verb and
 * the plan to the answer. The plan's name is ALSO checked at the route before it gets here
 * (`dispatcher.routes.ts`), because two fences is what keeps the inner one honest when a new caller
 * appears.
 */

/** The verb relay's dependencies are the command's own: one bin, one ceiling, one environment. */
export type DispatcherVerbDependencies = DispatcherCommandDependencies;

/**
 * Runs one verb against one name — a plan's, or an arc's for the four the arc's door also opens on.
 * `verbArgs` follow the name — `schedule`'s hour, `model`'s word and `swarm`'s, each already checked
 * by the route against the shapes the dispatcher accepts, and `planner-resume`'s `--by app:card`, which the
 * route spells itself; `stop`, `resume`, `park`, `unpark` and `drop` take none.
 */
export async function runDispatcherVerb(
  verb: DispatcherVerb,
  plan: string,
  dependencies: DispatcherVerbDependencies,
  verbArgs: readonly string[] = [],
): Promise<DispatcherVerbResult> {
  const answer = await runDispatcherCommand([verb, plan, ...verbArgs], dependencies);
  // `DispatcherVerbResult`'s own key order, written out rather than spread: a 409's body is this
  // object serialized, and the bytes the card has always read must not move. `reason` is present only
  // when the dispatcher never got to answer.
  return {
    ok: answer.ok,
    verb,
    plan,
    exit: answer.exit,
    stdout: answer.stdout,
    stderr: answer.stderr,
    ...(answer.reason === undefined ? {} : { reason: answer.reason }),
  };
}
