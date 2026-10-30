import type { DispatcherAsk } from '@/shared/types.js';

/**
 * THE WORDS OF KAYLEE'S DOORS INTO THE DISPATCHER AND THE RUNS (kaylee--eyes, seam K).
 *
 * Kaylee carries an act on the operator's spoken word, and the dispatcher's and the plan-runner's
 * doors admit her for it only with the record of that word attached (kaylee--press: who spoke, when,
 * what he said, which press of his it was). Three modules read these types — the companion builds an
 * order out of a prepared action, the dispatcher carries the verbs, dispatch-souls resumes a run —
 * which is why they live here and hold TYPES ONLY. The record's writer is `relay-record.ts`.
 *
 * Two places differ from the seam as the design first drew it, and each is named here: `ResumeRunOrder` carries the PATH of
 * the rulings file (`rulingsFile`), not the rulings, because dispatch-souls cannot reach her scratch folder without importing the
 * companion; and `relayRecord` lives in `server/shared/relay-record.ts`, not in the dispatcher module, because two modules (the
 * dispatcher and dispatch-souls) write the record.
 */

//----------------- HIS PRESS, AS THE RECORD CARRIES IT ------------

/**
 * His press, as kaylee--press's record carries it; the door adds `by` (`app:kaylee`) and `target` (the card, or the
 * chain, the verb acts on) when the record is written (`relayRecord`).
 *
 * `account` is the login that spoke; `saidAt` is the time of his line (ISO); `words` is that line verbatim; `press`
 * is its id in her log, the press the record points at; `token` is the lock token he heard read back — an Accept's, `null` for every
 * other act. The companion's `take_action` fills it from her log, never from anything she said. The doors do not copy it into the
 * record: the dispatcher lane writes the record's own `token` (an Accept's `--lock`, none on any other act), because the door takes
 * a token on an Accept alone and a Rework's press pins an Accept prompt but its `tell` has none.
 */
export type RelayedPress = {
  account: { id: number; name: string };
  saidAt: string;
  words: string;
  press: number;
  token: string | null;
};

// ---------------------------
//----------------- THE ORDERS A DOOR CARRIES ------------

/**
 * One act on his word, for the dispatcher lane (`createDispatcherModule().relay`).
 *
 * - `queue` and `hide-lock` answer the open Accept prompt `ask` (Queue; Hide, which approves and holds);
 * - `rework-lock` answers it with `notes`, his own words, sent to the designer;
 * - `answers` carries a questions round's `brief` (his answers, as `Q:`/`A:` pairs) to the designer;
 * - the six verbs with a `name` act on that plan or epic; `tell` carries `brief` verbatim on stdin.
 *
 * An `ask` is the prompt exactly as she read it back to him: the dispatcher's book finds its own record of the ask by
 * the ask's name and carries THAT, so an order whose ask has been re-cut or answered since is refused, never carried.
 */
export type RelayOrder =
  | { verb: 'queue' | 'hide-lock'; ask: DispatcherAsk; press: RelayedPress }
  | { verb: 'rework-lock'; ask: DispatcherAsk; notes: string; press: RelayedPress }
  | { verb: 'answers'; ask: DispatcherAsk; brief: string; press: RelayedPress }
  | { verb: 'hide' | 'show' | 'recut' | 'stop' | 'resume' | 'kick'; name: string; press: RelayedPress }
  | { verb: 'tell'; name: string; brief: string; press: RelayedPress };

/**
 * A run resumed with his rulings (`createDispatchSoulsModule().resumeRun`): `plan-runner chain --resume <chainId>
 * --rulings <rulingsFile> --relay <record>`.
 *
 * `rulingsFile` is the path of a file the companion has already written his rulings to, in her scratch (numbered and pruned like
 * every render) — dispatch-souls cannot reach her scratch folder without importing the companion, so the path travels and the
 * rulings do not.
 */
export type ResumeRunOrder = { chainId: string; rulingsFile: string; press: RelayedPress };

/**
 * What a door did with an order: `took` it, found it `already` done (an Accept that reached a plan approved before it arrived),
 * or `refused` it. `said` is the door's own first line, or the lane's sentence when the word never reached the door.
 */
export type RelayAnswer = { outcome: 'took' | 'already' | 'refused'; said: string };
