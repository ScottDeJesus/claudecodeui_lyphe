import type { CerberusRedItem } from '@/modules/notifications/index.js';

import { troubleDiagnoses } from './check-trouble.js';

/**
 * What a page says its check's trouble was found to be: the red watch's one lookup of a finished diagnosis.
 *
 * It reads the TROUBLE'S own bound (`check-trouble.ts`, a diagnosis started since the check was last ok, whoever
 * asked for it), the bound the auto-diagnosis trigger counts by, so the phone names the diagnosis the trigger
 * counted — one a person asked for with Diagnose included. The newest `done` row wins; a trouble with only a running
 * or a failed diagnosis, or none, has nothing to say, and the page goes out as it always did.
 *
 * It answers `undefined` rather than throw: the page is the operator's alarm, and a store that cannot be read,
 * or a stored proposal that cannot be parsed, costs the page its cause and never the page (INV-10187). That
 * failure is one `[red-watch]` log line.
 *
 * Consumer: `red-watch.service.ts`, after the incident's transaction and before the event is handed over.
 */

/** The `{ name, cmd }` a done diagnosis proposed, read from its stored JSON; a throw names what was wrong with it. */
function fixOf(storedProposal: string): { name: string; cmd: string } {
  const proposal = JSON.parse(storedProposal) as { name?: unknown; cmd?: unknown } | null;
  if (proposal === null || typeof proposal.name !== 'string' || typeof proposal.cmd !== 'string') {
    throw new TypeError('its stored proposal is not { name, cmd }');
  }
  return { name: proposal.name, cmd: proposal.cmd };
}

/**
 * The newest finished diagnosis of the check's trouble as a page carries it — its summary and the name and
 * command of what it proposed (`fix` is `null` when it proposed none) — or `undefined` when the trouble has none.
 */
export function pushDiagnosisOf(node: string, key: string): CerberusRedItem['diagnosis'] {
  try {
    const done = troubleDiagnoses(node, key).find((row) => row.status === 'done');
    if (done === undefined || done.summary === null) return undefined;
    return { summary: done.summary, fix: done.proposal === null ? null : fixOf(done.proposal) };
  } catch (error) {
    console.error(
      `[red-watch] ${node}/${key} goes out without its diagnosis, which could not be read: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}
