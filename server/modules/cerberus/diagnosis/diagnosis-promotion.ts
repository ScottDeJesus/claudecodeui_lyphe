import { cerberusCatalogDb, cerberusResultsDb, type CerberusDiagnosisRow } from '@/modules/database/index.js';
import type { CerberusCatalogEntryView } from '@/shared/cerberus-types.js';
import { AppError } from '@/shared/utils.js';

import { badEntry } from '../catalog-entry-input.js';
import { ONE_OFF_TIMEOUT_S, setAuto, writeEntry } from '../catalog.service.js';
import { wardenLinks } from '../warden-links.js';

import { findDiagnosis, proposalOf } from './diagnosis-proposal.js';

/**
 * Promotion: a diagnosis's proposal becomes a catalog entry — "Add to catalog". Spec §3, as written:
 * `check` and `when` come from the diagnosed check, `cmd` from the proposal's `general` (its absolute
 * times already made relative windows, so it works next week and not only at 17:50), `auto` starts off
 * unless the person switched it on, the limit is the one chosen in the dialog, and `origin` points
 * back at the diagnosis. The entry is written through `writeEntry`, the catalog's one writer, so it
 * is validated, published to the node's next set and told to the screens like any other.
 *
 * WHICH `when`. `warn` when the check was only nearing its limit when it was diagnosed, else `failing`.
 * The word is the check's STORED status as of the moment the diagnosis began — read from the store, by
 * the warden's clock — never its status now: a fix that worked has turned the check green by the time
 * anyone presses "Add to catalog", and that must not decide what the entry applies to.
 *
 * THE LIMIT is 1, 2 or 4 runs an hour, the chips of the dialog; the catalog itself would take 1 to 10 runs
 * in an hour or in a day, and this door is narrower on purpose, since the person is choosing for a command
 * a model wrote. The timeout is the one-off's own (`ONE_OFF_TIMEOUT_S`): the command ran, or would have, for that long.
 *
 * ONCE. A diagnosis is promoted at most once — `CerberusDiagnosisView.promotedTo` names a single entry,
 * and the tab shows it. A second press is a 409 `CERBERUS_DIAG_PROMOTED`, also when the entry was retired
 * since (a withdrawn fix is not quietly written again by the same button); the person writes it by hand.
 * The check and the write happen in one synchronous run, so two presses cannot both pass.
 *
 * Consumers: `diagnosis.routes.ts` (`POST /diagnoses/:id/promote`); `whenDiagnosed` also `read-model/diagnosis-views.ts`.
 */

/** The limits the dialog offers, runs in an hour. */
const OFFERED_RUNS_PER_HOUR: readonly number[] = [1, 2, 4];
const HOUR_SECONDS = 3600;

/**
 * `warn` when the check's stored status at the moment the diagnosis began was `warn`, else `failing`.
 * Results are on the warden's clock and the diagnosis's start is center's, so the start is brought
 * onto the warden's with the node's offset; a check with no change stored by then is `failing`.
 * Consumers: this file's promotion, which writes the word, and `read-model/diagnosis-views.ts`, which tells the screen
 * the same word (`CerberusDiagnosisView.when`) so the Promote dialog shows what will be written.
 */
export function whenDiagnosed(diagnosis: CerberusDiagnosisRow): CerberusCatalogEntryView['when'] {
  const startedOnWardenClock = diagnosis.started_at - wardenLinks.clockOffsetMs(diagnosis.node);
  const [change] = cerberusResultsDb.recentChanges(diagnosis.node, diagnosis.check_key, 0, 1, startedOnWardenClock);
  return change?.status === 'warn' ? 'warn' : 'failing';
}

/**
 * Promotes the diagnosis `id` into the catalog for `by`: `name` is the button's words, `auto` whether
 * Cerberus may run it on its own, `limit` how often. Answers the new entry. Refusals, in the order they
 * are judged: 404 for an unknown diagnosis, 400 `CERBERUS_BAD_ENTRY` naming `limit.runs` or `limit.per` for a
 * limit that is not offered, 409 `CERBERUS_NO_PROPOSAL` for a diagnosis with nothing to promote, 409
 * `CERBERUS_DIAG_PROMOTED` for one already promoted, and the catalog's own 400s for a name it refuses.
 */
export function promoteDiagnosis(
  id: string,
  input: { name: string; auto: boolean; limit: { runs: number; per: number } },
  by: string
): CerberusCatalogEntryView {
  const diagnosis = findDiagnosis(id);

  // The body is judged before the diagnosis's state: a limit that is not offered is wrong whatever the diagnosis did.
  if (!OFFERED_RUNS_PER_HOUR.includes(input.limit.runs)) throw badEntry('limit.runs', 'must be 1, 2 or 4 runs an hour');
  if (input.limit.per !== HOUR_SECONDS) throw badEntry('limit.per', 'must be 3600 seconds, an hour');

  const proposal = proposalOf(diagnosis);
  const earlierEntry = cerberusCatalogDb.promotedFrom([id]).get(id);
  if (earlierEntry !== undefined) {
    const earlier = cerberusCatalogDb.get(earlierEntry);
    const earlierName = earlier?.name ?? earlierEntry;
    // A withdrawn entry is in no list and no set: saying the diagnosis is "in the catalog" would be false.
    const sentence =
      earlier?.retired_at != null
        ? `This diagnosis was added to the catalog as “${earlierName}”, which has since been withdrawn. A diagnosis is added once: write the fix by hand if it is wanted again.`
        : `This diagnosis is already in the catalog as “${earlierName}”.`;
    throw new AppError(sentence, { code: 'CERBERUS_DIAG_PROMOTED', statusCode: 409 });
  }

  const entry = writeEntry(
    {
      node: diagnosis.node,
      check: diagnosis.check_key,
      name: input.name,
      when: whenDiagnosed(diagnosis),
      cmd: proposal.general,
      timeout: ONE_OFF_TIMEOUT_S,
      limit: input.limit,
      recheck: true,
    },
    { kind: 'diagnosis', diagnosis: diagnosis.id, at: Date.now() }
  );
  // `writeEntry` starts every entry with auto-run off: switching it on is its own decision, and its own change row.
  return input.auto ? setAuto(entry.id, true, by) : entry;
}
