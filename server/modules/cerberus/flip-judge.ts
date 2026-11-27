import type { CerberusOverview, CerberusReadInputs } from '@/shared/cerberus-types.js';

import type { FlipJudgement } from './cerberus-broadcast.js';
import { buildOverview } from './read-model/overview.js';

/**
 * THE MOMENTS TIME ALONE MOVES THE FLEET: collected from a tab's read, and judged when one comes.
 *
 * A tab's read hands the read model a collector (`inputs.flipsAt`), which keeps the earliest instant after the
 * read's `now` at which something it decided turns with nothing written; the route hands that instant to
 * `armFlipDeadline`. Most of those instants are only a forecast: a check that keeps reporting moves its
 * last-received time in ingest's memory without storing a row, and a warden's heartbeat moves its node's, so
 * the stale or silent instant a read saw has often moved on by the time it comes. The judge is what keeps
 * that from becoming a frame: it reads the fleet just before the instant and again now, and names only the
 * checks and nodes whose word really changed.
 *
 * Consumers: `cerberus.routes.ts` (the collector on the two tab reads, and the judge it registers with
 * `judgeFlipsWith`).
 */

/** One read's collector: `flipsAt` for the read model, `earliest` for the deadline. */
export type FlipCollector = { flipsAt: (at: number) => void; earliest: () => number | null };

/** A collector for a read standing at `now`: an instant at or before it is already true and is not kept. */
export function collectFlips(now: number): FlipCollector {
  let earliest: number | null = null;
  return {
    flipsAt: (at) => {
      if (at > now && (earliest === null || at < earliest)) earliest = at;
    },
    earliest: () => earliest,
  };
}

/** Every node's link and every check's status in one overview, keyed by node id and by `<node>/<key>`. */
type FleetWords = { links: Map<string, string>; statuses: Map<string, string> };

function fleetWordsOf(overview: CerberusOverview): FleetWords {
  const links = new Map<string, string>();
  const statuses = new Map<string, string>();
  for (const node of overview.nodes) {
    links.set(node.id, node.link);
    for (const service of node.services) {
      for (const check of service.checks) statuses.set(`${check.node}/${check.key}`, check.status);
    }
  }
  return { links, statuses };
}

/** The keys whose word in `after` is not their word in `before`; a key only one side holds counts as moved. */
function movedKeys(before: Map<string, string>, after: Map<string, string>): string[] {
  const moved: string[] = [];
  for (const [key, word] of after) if (before.get(key) !== word) moved.push(key);
  for (const key of before.keys()) if (!after.has(key)) moved.push(key);
  return moved;
}

/**
 * Whether the instant `at` turned anything: the fleet read one millisecond before it against the fleet read now,
 * from one set of inputs, so a result or heartbeat that arrived meanwhile reads the same on both sides and
 * moves nothing. Answers the nodes and checks that moved, and the next instant this reading forecasts.
 */
export function judgeFlip(at: number, readInputs: () => CerberusReadInputs): FlipJudgement {
  const inputs = readInputs();
  const flips = collectFlips(inputs.now);
  const after = fleetWordsOf(buildOverview({ ...inputs, flipsAt: flips.flipsAt }));
  const before = fleetWordsOf(buildOverview({ ...inputs, now: Math.min(at, inputs.now) - 1 }));
  return {
    nodes: movedKeys(before.links, after.links),
    checks: movedKeys(before.statuses, after.statuses),
    next: flips.earliest(),
  };
}
