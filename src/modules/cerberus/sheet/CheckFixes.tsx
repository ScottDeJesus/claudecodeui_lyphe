import type { TFunction } from 'i18next';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import type { CerberusCatalogEntryView, CerberusRunView } from '@/shared/cerberus-types';
import { Button } from '@/shared/ui';

/** What an entry does on its own, as the sheet says it: its capped reason, "Runs on its own · at most 2 runs an hour", or "Offered · you press it". */
function autoLine(t: TFunction, { capped, auto, limit }: CerberusCatalogEntryView): string {
  if (capped !== null) return capped;
  if (!auto) return t('cerberus.fix.sheet.offered');
  return t('cerberus.catalog.auto.on', { count: limit.runs, context: limit.per === 86_400 ? 'day' : 'hour' });
}

type CheckFixesProps = {
  /** The check's catalog entries, every `when`, oldest first: `CerberusCheckDetail.fixes`. */
  fixes: CerberusCatalogEntryView[];
  /** The check's latest run within the hour (`CerberusCheckDetail.run`): while it is going, the check takes no other. */
  run: CerberusRunView | null;
  /** A Run now of one of these entries started the run `runId`: the sheet's Fix output moves to that run and the sheet reads the check again. */
  onRunStarted: (runId: string) => void;
};

/**
 * FIXES IN THE CATALOG: the entries that fix this check, each with Run now (`design/cerberus/Cerberus
 * Tab.dc.html` :489-504). In the check sheet, under Fix output and the diagnosis.
 *
 * Each entry is a row: its name, its command after a `$`, and what it does on its own — the capped reason,
 * "Runs on its own · at most 2 runs an hour", or "Offered · you press it" — then Run now (tonal). The
 * entry whose run is going reads "Running…" and keeps its place in the tab order (`aria-disabled`, never
 * `disabled`, which blurs the button under the person who pressed it); every other entry waits, disabled,
 * since center takes one run on a check at a time. With no entry on the check, a dashed line says so, and where
 * the way to one is: "No catalog fix covers this check yet. Diagnose it — a good diagnosis can become one."
 *
 * For the check sheet (`CheckSheet`), with the check's read.
 */
export function CheckFixes({ fixes, run, onRunStarted }: CheckFixesProps) {
  const { t } = useTranslation();
  const headingId = useId();
  // `starting` holds the entries whose Run press is still out (`runEntry` waits up to 10 s for the warden's ack).
  const { starting, runEntry } = useCerberus();
  // The run a press started is the sheet's to show: the answer names it, and the sheet's Fix output opens on that run.
  const onRun = (entry: CerberusCatalogEntryView) => {
    void runEntry(entry.id, onRunStarted);
  };
  const going = run !== null && run.result === null ? run : null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h4 id={headingId} className="m-0 text-xs font-normal uppercase tracking-[0.14em] text-muted-foreground">{t('cerberus.fix.sheet.title')}</h4>
      {fixes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-4 py-3.5 text-[13px] text-muted-foreground">
          {t('cerberus.fix.sheet.none')} {t('cerberus.diagnosis.hint')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {fixes.map((entry) => {
            const busy = starting.includes(entry.id) || going?.entry === entry.id;
            return (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-xl border border-border px-3.5 py-3">
                <div className="min-w-0 flex-[1_1_240px]">
                  <p className="text-sm font-medium [overflow-wrap:anywhere]">{entry.name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{t('cerberus.fix.command', { cmd: entry.cmd })}</p>
                  <p className="text-[12.5px] text-muted-foreground">{autoLine(t, entry)}</p>
                </div>
                <Button
                  variant="tonal"
                  size="sm"
                  disabled={going !== null && !busy}
                  busy={busy}
                  // One width for both words, so the row does not reflow when a run starts or ends.
                  className="min-w-24"
                  onClick={() => onRun(entry)}
                >
                  {busy ? t('cerberus.catalog.running') : t('cerberus.catalog.runNow')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
