import type { ChainRun } from '@/modules/dispatch-souls/index.js';
import type { SoulLaunchState } from '@/shared/types.js';

/**
 * A run's state in HER words, and the three kinds the list scopes sort by. PURE: no I/O, no clock of its own.
 *
 * The words are the ones interface E2 lists: building, in review, fixing, writing the docs, done, failed at <stage>,
 * stopped, and stopped for your ruling. They are read off the run's OWN record (`chain.json`'s status and current stage;
 * a soul's role and lane state), never off a vendor, a provider or a spend figure (operator ruling 1).
 *
 * Consumers: `run-list.ts` (the list's lines and scopes), `run-scopes.ts` (the head of each `read_run` answer) and
 * `run-resolve.ts` (a run's state for a refusal that names candidates).
 */

/** What a run is doing, coarsely: `running` (out), `done`, `waiting` on him (a ruling) or `bad` (failed, or stopped short of done). */
type RunKind = 'running' | 'done' | 'waiting' | 'bad';

/** A run's state: the words she says, and the kind the `running`, `recent` and `failed` scopes sort by. Consumed by `run-list.ts`. */
export type RunState = { words: string; kind: RunKind };

/** How long after its last write a record that says `running` with no walker alive is still trusted: the walker writes its pid a moment after it starts. */
const WALKER_GRACE_S = 90;

/** The current stage's name, in the words of the work it does. `scenarios` and `builder` build; `athena-N` and `review` review; `fix-pass(-rN)` fixes; `prometheus` writes the docs. */
const STAGE_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(athena|iris|review)/, 'in review'],
  [/^fix/, 'fixing'],
  [/^prometheus/, 'writing the docs'],
];

/** The words for a stage or a role that is out right now; anything that is not a review, a fix or the docs is building. */
function workingWords(name: string | null): string {
  const lowered = (name ?? '').toLowerCase();
  return STAGE_WORDS.find(([pattern]) => pattern.test(lowered))?.[1] ?? 'building';
}

/**
 * A chain's state from its record. `done` (and the runner's `nothing-changed`) is done; `ruling` is stopped for his ruling;
 * a `dead` chain with a stop marker is stopped, any other `dead` or `blocked` one failed at its failed stage; a `running` record
 * is working in the words of its current stage, unless its walker is gone and the record has not been written for 90 s —
 * a corpse the runner has not yet settled, which is failed at that stage. An unknown status word is failed too: saying a
 * run is fine when this file does not understand its word is the answer that could mislead. `nowS` is epoch SECONDS.
 * Consumed by `run-list.ts` and `run-scopes.ts`.
 */
export function chainState(chain: ChainRun, nowS: number): RunState {
  const failedAt = `failed at ${chain.failed_stage ?? chain.stage ?? 'the start'}`;
  switch (chain.status) {
    case 'done':
    case 'nothing-changed':
      return { words: 'done', kind: 'done' };
    case 'ruling':
      return { words: 'stopped for your ruling', kind: 'waiting' };
    case 'dead':
      return chain.stopped_by !== null ? { words: 'stopped', kind: 'bad' } : { words: failedAt, kind: 'bad' };
    case 'running': {
      const fresh = chain.updated_at !== null && nowS - chain.updated_at < WALKER_GRACE_S;
      return chain.walker_alive || fresh ? { words: workingWords(chain.stage), kind: 'running' } : { words: failedAt, kind: 'bad' };
    }
    default:
      return { words: failedAt, kind: 'bad' };
  }
}

/**
 * A soul alone's state from the lane's own word and its role: out is working in the words of its role (a `fix-pass` fixes, an
 * `athena` reviews, `prometheus` writes the docs, else building); `completed` is done; `stopped` (the launcher's idle, timeout and
 * orphan caps) is stopped; `failed` is failed at its role. Consumed by `run-list.ts` and `run-scopes.ts`.
 */
export function soulState(role: string, state: SoulLaunchState): RunState {
  switch (state) {
    case 'running':
      return { words: workingWords(role), kind: 'running' };
    case 'completed':
      return { words: 'done', kind: 'done' };
    case 'stopped':
      return { words: 'stopped', kind: 'bad' };
    default:
      return { words: `failed at ${role || 'the start'}`, kind: 'bad' };
  }
}
