import { useCallback, type MutableRefObject } from 'react';
import type { TFunction } from 'i18next';

import type { CerberusValue } from '@/modules/cerberus/context/CerberusContext';
import { api } from '@/shared/api';
import type { CerberusCatalogEntryView } from '@/shared/cerberus-types';
import type { CerberusPromoteInput, ToastRequest } from '@/shared/types';

/** What the provider lends the verbs: its one-write-per-target guard, its one place a refused write becomes a toast, and the speech and mount flag its other verbs use. */
type DiagnosisWriteTools = {
  writeOnce: <Answer>(target: string, write: () => Promise<Answer>) => Promise<Answer>;
  /** `settleWrite`: sends the request, re-reads the fleet when it landed, and toasts the server's sentence when it did not. */
  settleWrite: (request: () => Promise<Response>) => Promise<'landed' | 'refused' | 'failed'>;
  toast: (request: ToastRequest) => void;
  tRef: MutableRefObject<TFunction>;
  mountedRef: MutableRefObject<boolean>;
};

/**
 * THE DIAGNOSIS'S THREE WRITES, for `CerberusProvider` to put on its value. Each rides the provider's
 * `settleWrite`: a landed write has re-read the fleet before it answers, and a refused one (a diagnosis already going
 * on the check, a one-off that ran out, a limit not offered) has raised the write's own toast with the server's sentence.
 *
 * - `diagnose` starts a read-only diagnosis of one check. It sends no model: center picks its own. Silent when it
 *   lands, since the card says "Diagnosing…" and the sheet's panel says "Reading…".
 * - `runProposal` runs a diagnosis's proposal once, by you. Silent when it lands: the panel's "Running now" line and
 *   the output under it are the proof. It never touches the catalog.
 * - `promote` turns the proposal into a catalog entry, the one write here that changes the catalog. It speaks when it
 *   lands — "Added to the catalog" · "<name> · auto-run off" — since the entry is on another tab.
 *
 * A second press on the same target answers the first's verdict, so a double click starts one diagnosis, one run, one entry.
 */
export function useDiagnosisVerbs({ writeOnce, settleWrite, toast, tRef, mountedRef }: DiagnosisWriteTools): Pick<CerberusValue, 'diagnose' | 'runProposal' | 'promote'> {
  const diagnose = useCallback((node: string, key: string): Promise<boolean> => writeOnce(
    `diagnose:${node}/${key}`,
    async () => (await settleWrite(() => api.cerberus.diagnose({ node, check: key }))) === 'landed',
  ), [writeOnce, settleWrite]);

  const runProposal = useCallback((id: string): Promise<boolean> => writeOnce(
    `run-proposal:${id}`,
    async () => (await settleWrite(() => api.cerberus.runProposal(id))) === 'landed',
  ), [writeOnce, settleWrite]);

  const promote = useCallback((id: string, input: CerberusPromoteInput): Promise<boolean> => writeOnce(
    `promote:${id}`,
    async () => {
      // The entry as the server wrote it, read from a landed answer only: a refusal's body is `settleWrite`'s to read for its sentence.
      let written: CerberusCatalogEntryView | null = null;
      const verdict = await settleWrite(async () => {
        const response = await api.cerberus.promote(id, input);
        if (response.ok) {
          try {
            written = (await response.json()) as CerberusCatalogEntryView;
          } catch {
            // The write landed (`response.ok` is its verdict) and only its answer is unreadable; the toast names the typed name instead.
          }
        }
        return response;
      });
      if (verdict !== 'landed') return false;
      if (mountedRef.current) {
        const entry = written as CerberusCatalogEntryView | null;
        toast({
          tone: 'positive',
          title: tRef.current('cerberus.promote.toast.title'),
          message: tRef.current(input.auto ? 'cerberus.promote.toast.messageOn' : 'cerberus.promote.toast.messageOff', { name: entry?.name ?? input.name }),
        });
      }
      return true;
    },
  ), [writeOnce, settleWrite, toast, tRef, mountedRef]);

  return { diagnose, runProposal, promote };
}
