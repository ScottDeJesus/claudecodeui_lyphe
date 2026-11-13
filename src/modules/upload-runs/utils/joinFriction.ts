import type { HealSessionsAnswer } from '@/modules/heal';
import type { RunFriction } from '@/modules/upload-runs/utils/uploadsModel';

/** The status of a heal whose fix has landed; `running` is one still being built, `blocked` one that stopped short. */
const LANDED = 'done';
const RUNNING = 'running';

/**
 * The heal answer joined per Claude session: for each session, the rows its agent filed (the ignored ones left out: the
 * ledger's owner has already said they are not friction), how many of those a LANDED heal took, and how many still stand.
 * A row a running or a blocked heal claimed has not been healed, so it counts as open until the heal lands. A session
 * that filed nothing has no entry, which the rows read as "no mark", never as a count of zero.
 *
 * Used by `useUploadsRead`, which hands the map to the Runs list and the type rows as `read.friction`.
 */
export function joinFriction(answer: HealSessionsAnswer): Map<string, RunFriction> {
  const landed = new Set(answer.heals.filter((heal) => heal.status === LANDED).map((heal) => heal.id));
  const bySession = new Map<string, RunFriction>();
  for (const item of answer.items) {
    if (item.ignored) continue;
    const friction = bySession.get(item.session) ?? { rows: 0, healed: 0, open: 0 };
    friction.rows += 1;
    if (item.claimed_by !== null && landed.has(item.claimed_by)) friction.healed += 1;
    else friction.open += 1;
    bySession.set(item.session, friction);
  }
  return bySession;
}

/**
 * How many of the answer's heals have landed and how many are still running: the Healed pill's two figures. A blocked heal
 * is neither. The answer holds only heals that claimed or cured a row of the sessions asked for, so these are the heals
 * of THIS window's friction and never the ledger's whole count.
 */
export function healedCounts(answer: HealSessionsAnswer): { landed: number; running: number } {
  return {
    landed: answer.heals.filter((heal) => heal.status === LANDED).length,
    running: answer.heals.filter((heal) => heal.status === RUNNING).length,
  };
}
