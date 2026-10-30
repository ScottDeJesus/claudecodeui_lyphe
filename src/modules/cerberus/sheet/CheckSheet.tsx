import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { useCheckDetail } from '@/modules/cerberus/hooks/useCheckDetail';
import { CheckFixes } from '@/modules/cerberus/sheet/CheckFixes';
import { CheckLabelEditor } from '@/modules/cerberus/sheet/CheckLabelEditor';
import { CheckRows } from '@/modules/cerberus/sheet/CheckRows';
import { DiagnosisPanel } from '@/modules/cerberus/sheet/DiagnosisPanel';
import { FixOutput } from '@/modules/cerberus/sheet/FixOutput';
import { LookupMoment } from '@/modules/cerberus/sheet/LookupMoment';
import { MinuteCells } from '@/modules/cerberus/sheet/MinuteCells';
import { RecordedResults } from '@/modules/cerberus/sheet/RecordedResults';
import { SelectedCheck } from '@/modules/cerberus/sheet/SelectedCheck';
import { UnreachableBanner } from '@/modules/cerberus/UnreachableBanner';
import { hms, isWholeTime } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusCell, CerberusCheckView, CerberusDiagnosisView, CerberusNodeView, CerberusServiceView } from '@/shared/cerberus-types';
import { Sheet } from '@/shared/ui';

// The prototype's stagger: the raw line rises first, the rows 60 ms after it, and the check with its
// history 120 ms after. Inline, as `tailwind.config.js` says beside `shape-rise`, so no class order can
// let the rise's shorthand reset the delay.
const ROWS_ENTER = { animationDelay: '60ms' } as const;
const CHECK_ENTER = { animationDelay: '120ms' } as const;

/** A whole time input ("17:52" or "17:52:10") as that second today, local time, in epoch ms. */
function todayAt(time: string): number {
  const [hours, minutes, seconds = 0] = time.split(':').map(Number);
  return new Date().setHours(hours, minutes, seconds, 0);
}

type CheckSheetProps = {
  /** Whether the sheet is up. Closed, nothing under its head is mounted, so nothing there reads. */
  open: boolean;
  onClose: () => void;
  /** The node the check runs on: `eis1`, or `center` for Cerberus's own checks. */
  node: string;
  /** The service the check belongs to, by id: `shadow-connector`. */
  service: string;
  /** The check the sheet opens on, by its id within the service: `session.valid`, its key after the first `/`. */
  check: string;
  /** The moment the lookup opens on, epoch ms: the minute a service row's cell was pressed on. Omitted, now. */
  lookupAt?: number;
  /** The run a Needs-you card's strip or a What happened row opened the sheet on, which its Fix output shows until a Run now is pressed in the sheet. Omitted, the check's latest run within the hour. */
  run?: string;
  /** Mute, pressed for the check the sheet shows. The root opens its Mute dialog in front of the sheet. Absent, no Mute is offered. */
  onMute?: (check: CerberusCheckView) => void;
  /** Add to catalog, pressed on the diagnosis of the check the sheet shows. The root opens its Promote dialog in front of the sheet, as it does Mute. Absent, no Add to catalog is offered. */
  onPromote?: (diagnosis: CerberusDiagnosisView, check: CerberusCheckView) => void;
  /** The sheet's width, any CSS width; omitted, the kit `Sheet`'s own (`min(600px, 100%)`). */
  width?: string;
};

/**
 * THE CHECK SHEET: one service's checks at a glance and one of them in full, beside the screen on the
 * library's `Sheet` (`design/cerberus/Cerberus Tab.dc.html` :393-537).
 *
 * Titled with the service's label (its id until it has one), then the raw line "<service> · <node> ·
 * warden <version>". Under it the service's checks as rows; then the check the sheet shows — its name,
 * its word, its value, when it was checked, Diagnose, Mute or its mute; then Fix output (one run of a fix, as it
 * happens or as it happened), the Diagnosis (read-only, its steps arriving as it works) and "Fixes in the
 * catalog"; then its last 60 minutes, a moment looked up, and the results recorded in the last 3 h.
 *
 * TWO READS, and the sheet never blanks while one is out. The fleet the provider keeps already holds
 * the service, its checks and its node's warden, so the head, the rows and the check's own block are
 * drawn the moment the sheet opens. The check's own read brings the minutes, the lookup and the
 * record: shimmering placeholders until it answers; a warn banner with Try again when it fails, over
 * the last good answer when there is one; a plain line when the check is gone.
 *
 * For the cerberus module's `CerberusPanel`, which hosts one and opens it from a service row's minute
 * and from Needs you, with its Mute and Promote dialogs; and for the station module's check stage
 * (`CheckStage`, through the barrel), which opens it on a red check over the station's right side, at
 * the width that keeps it off her face, and hosts neither dialog, so its sheet offers no Mute and no
 * Add to catalog.
 */
export function CheckSheet({ open, onClose, node, service, check, lookupAt, run, onMute, onPromote, width }: CheckSheetProps) {
  // The fleet the provider keeps: it names the service and its node before the check is read.
  const { overview } = useCerberus();
  const nodeView = overview?.nodes.find((entry) => entry.id === node) ?? null;
  const serviceView = nodeView?.services.find((entry) => entry.service === service) ?? null;

  return (
    <Sheet open={open} onClose={onClose} title={serviceView?.label ?? service} width={width}>
      {/* Keyed by what the sheet opened on, so a sheet sent to another check or minute starts over:
          that row, that moment, the editor closed. */}
      <CheckSheetBody
        key={`${node}/${service}/${check}@${lookupAt ?? 'now'}`}
        node={node}
        service={service}
        check={check}
        lookupAt={lookupAt}
        nodeView={nodeView}
        serviceView={serviceView}
        run={run}
        onMute={onMute}
        onPromote={onPromote}
      />
    </Sheet>
  );
}

type CheckSheetBodyProps = Omit<CheckSheetProps, 'open' | 'onClose' | 'width'> & {
  nodeView: CerberusNodeView | null;
  serviceView: CerberusServiceView | null;
};

/** Everything under the sheet's head. The `Sheet` mounts it only while it is open, so its reads run only then. */
function CheckSheetBody({ node, service, check, lookupAt, run, nodeView, serviceView, onMute, onPromote }: CheckSheetBodyProps) {
  const { t } = useTranslation();

  // The check the sheet shows, by its id within the service. Essential: a pressed row moves the sheet
  // to a sibling without closing it, and `check` only says where the sheet opened.
  const [selectedId, setSelectedId] = useState(check);
  // The moment the lookup is about, epoch ms; undefined is now, which keeps the read live. Essential:
  // a picked minute or a typed time moves it, and the check's read is keyed on it.
  const [moment, setMoment] = useState(lookupAt);
  // What a person has typed in the time input, or null while the input shows the moment the lookup
  // answered for. Essential: a half-typed time is "" and no moment, and the input must never be
  // rewritten from the read while someone is typing in it. Null on a live sheet, so the input moves
  // with the sentence at each re-read instead of keeping the second the sheet opened on.
  const [typedTime, setTypedTime] = useState<string | null>(null);
  // The check whose label editor is open, by id, or null. Essential: Name this check and ✎ open it for
  // the shown check, and Cancel, a save that lands and a press on another row close it. Held by id so a
  // write that lands late closes only the editor it was for.
  const [editingId, setEditingId] = useState<string | null>(null);
  // The check whose label write is in flight, by id, or null: the editor's `busy` for that check alone.
  // Essential: a write outlives a press on another row, and only this body knows which check it was for.
  const [savingId, setSavingId] = useState<string | null>(null);
  // The run each Run now pressed in this sheet started, by the id of the check it was pressed on. Essential:
  // it moves Fix output off the run the sheet opened on and onto that run, and holds it there when a newer
  // run of the check begins; only this body saw the press, and the check's read does not say which run it was.
  const [startedRuns, setStartedRuns] = useState<Record<string, string>>({});
  const { detail, error, refresh } = useCheckDetail({ node, service, id: selectedId, lookupAt: moment });
  const { liftMute, setLabel } = useCerberus();

  /** A minute pressed on the strip: the lookup goes to the moment its word was reached, and the time input follows the read. */
  const pickMinute = (cell: CerberusCell) => {
    // The newest cell is the minute still running (the read sends no `end`), whose word is still
    // forming, so the lookup goes back to live. Judged by its place on the strip and never by this
    // browser's clock, which is not the center's. Every other cell's `at` is a moment center has seen.
    const newest = detail?.cells[detail.cells.length - 1];
    setMoment(cell.from === newest?.from ? undefined : cell.at);
    setTypedTime(null);
  };

  /** The time input changed: its text is held as typed, and a whole time moves the lookup to that second today. */
  const changeTime = (text: string) => {
    setTypedTime(text);
    if (isWholeTime(text)) setMoment(todayAt(text));
  };

  /** Save from the editor. The editor closes once the write has landed, if it is still on the check the write was for; a refused one has toasted and leaves it open. */
  const saveLabel = async (id: string, key: string, label: string) => {
    setSavingId(id);
    const landed = await setLabel({ node, key, label });
    setSavingId((current) => (current === id ? null : current));
    if (landed) setEditingId((open) => (open === id ? null : open));
  };

  /**
   * A Run now pressed on check `id` started the run `runId`: Fix output shows it from here on, and the check is
   * read again so "Running…" and the going run stand. A read for a row the sheet has left since the press says
   * nothing (`useCheckDetail` drops it), and the pin waits under that row's id for the person's return.
   */
  const followStartedRun = (id: string, runId: string) => {
    setStartedRuns((held) => ({ ...held, [id]: runId }));
    void refresh();
  };

  const selectedKey = `${service}/${selectedId}`;
  // The rows are the fleet's copy of the service, so they hold still while a row's own read is out.
  // The read's check and siblings stand in only where the fleet has no copy.
  const rows = serviceView?.checks
    ?? (detail === null ? [] : [detail.check, ...detail.siblings].sort((a, b) => a.key.localeCompare(b.key)));
  // The check as the sheet shows it: the fleet's copy, the same one its row draws. Every write re-reads
  // the fleet before it answers, so after a mute, an unmute or a new name the head and the rows never
  // disagree. The check's own read stands in only where the fleet holds no copy of it.
  const shown = rows.find((entry) => entry.key === selectedKey) ?? detail?.check ?? null;
  // What the sheet's one polite region says: the wait while the check's read is out, the line when the
  // check is gone, and nothing otherwise. The banner speaks for itself, as an alert.
  const announcement = error === 'gone'
    ? t('cerberus.sheet.gone')
    : detail === null && error === null ? t('cerberus.sheet.loading') : '';
  // The run Fix output shows, in this order: the run the last Run now pressed in this sheet started; else the
  // run the sheet was opened on, whatever newer run the check's read names, so opening an older run from What
  // happened never lands on a newer one; with neither, the check's newest run within the hour. No run, no Fix
  // output.
  // A run of the shown diagnosis's proposal draws under its proposal (`DiagnosisPanel`, "Running now — output below"),
  // so Fix output leaves that run out, and a run of that diagnosis is never the one that holds the check against it.
  // `?? null`: an older server's answer has no diagnosis.
  const diagnosis = detail?.diagnosis ?? null;
  const proposalRunId = diagnosis?.run?.id ?? null;
  const openedRunId = selectedId === check ? run : undefined;
  const shownRunId = startedRuns[selectedId] ?? openedRunId ?? detail?.run?.id ?? null;
  const outputRunId = shownRunId === proposalRunId ? null : shownRunId;
  // Another run holds the check: going, and not this diagnosis's own one-off.
  const goingRun = detail?.run ?? null;
  const heldByOther = goingRun !== null && goingRun.result === null && goingRun.diagnosis !== diagnosis?.id;
  const version = nodeView?.wardenVersion ?? null;
  const raw = version === null
    ? t('cerberus.sheet.rawHub', { service, node })
    : t('cerberus.sheet.raw', { service, node, version });

  return (
    <div className="flex flex-col gap-[18px] pb-safe-area-inset-bottom">
      {/* Mounted with the body, so its words change inside a region that already exists and are
          announced; a region inserted with its words often is not (`LookupMoment` keeps its own the
          same way). */}
      <p role="status" className="sr-only">{announcement}</p>
      <p className="-mt-1 font-mono text-[11.5px] text-muted-foreground [overflow-wrap:anywhere] motion-safe:animate-shape-rise">
        {raw}
      </p>

      {rows.length > 0 && (
        <div className="motion-safe:animate-shape-rise" style={ROWS_ENTER}>
          <CheckRows
            checks={rows}
            selectedKey={selectedKey}
            serviceName={serviceView?.label ?? service}
            onSelect={(entry) => {
              setSelectedId(entry.id);
              setEditingId(null);
            }}
          />
        </div>
      )}

      {shown !== null && (
        // Keyed by the check, so another row's block comes in afresh.
        <div key={shown.key} className="motion-safe:animate-shape-rise" style={CHECK_ENTER}>
          <SelectedCheck
            check={shown}
            editor={editingId === selectedId ? (
              <CheckLabelEditor
                value={shown.label ?? ''}
                busy={savingId === selectedId}
                // An empty label clears the name, and the key shows again.
                onSave={(label) => void saveLabel(selectedId, shown.key, label)}
                onCancel={() => setEditingId(null)}
              />
            ) : null}
            onName={() => setEditingId(selectedId)}
            // The root's Mute dialog opens in front of the sheet, which stands down for it.
            onMute={onMute && (() => onMute(shown))}
            // The note leaves when the fleet reads the lift.
            onUnmute={() => {
              if (shown.mute !== null) void liftMute(shown.mute.id);
            }}
            diagnosis={diagnosis}
            diagnosisRead={detail !== null}
            // Center hints the check a second late; the sheet reads it at once, so the new diagnosis stands before Diagnose lets go.
            onDiagnosisStarted={refresh}
          />
        </div>
      )}

      {/* Keyed by the run, so another run's output starts blank and replays as its own. */}
      {outputRunId !== null && <FixOutput key={outputRunId} runId={outputRunId} />}
      {/* Keyed by the diagnosis, so a new one starts blank and its steps arrive as its own. */}
      {diagnosis !== null && shown !== null && (
        <DiagnosisPanel
          key={diagnosis.id}
          diagnosisId={diagnosis.id}
          held={heldByOther}
          onPromote={onPromote && ((promoted) => onPromote(promoted, shown))}
        />
      )}
      {/* `?? []` and `?? null`: an older server's answer has neither field. */}
      {detail !== null && <CheckFixes fixes={detail.fixes ?? []} run={detail.run ?? null} onRunStarted={(runId) => followStartedRun(selectedId, runId)} />}

      {error === 'gone' ? (
        <p className="rounded-xl border border-dashed border-input px-4 py-3.5 text-[13px] text-muted-foreground">
          {t('cerberus.sheet.gone')}
        </p>
      ) : (
        <>
          {error === 'unreachable' && (
            <UnreachableBanner
              onRetry={() => void refresh()}
              detail={detail === null ? undefined : t('cerberus.errors.lastAnswer')}
            />
          )}
          {detail !== null ? (
            <div className="flex flex-col gap-[18px] motion-safe:animate-shape-rise" style={CHECK_ENTER}>
              <SheetSection title={t('cerberus.sheet.lastHour')}>
                <MinuteCells
                  cells={detail.cells}
                  selectedFrom={detail.cells.find((cell) => cell.from <= detail.lookup.at && detail.lookup.at < cell.to)?.from}
                  onPick={pickMinute}
                />
              </SheetSection>
              <SheetSection title={t('cerberus.lookup.title')}>
                <LookupMoment
                  time={typedTime ?? hms(detail.lookup.at)}
                  onTimeChange={changeTime}
                  lookup={detail.lookup}
                  check={detail.check}
                />
              </SheetSection>
              <SheetSection title={t('cerberus.sheet.recorded')}>
                <RecordedResults rows={detail.recent} />
              </SheetSection>
            </div>
          ) : error === null && <ReadingPlaceholder />}
        </>
      )}
    </div>
  );
}

/** One of the sheet's lower sections: its eyebrow, which heads it under the check's name, then what it holds. */
function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h4 id={headingId} className="m-0 text-xs font-normal uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}

/**
 * The three sections' shapes, shimmering, while the check's own read is out. Their eyebrows are drawn
 * already, since the words are known, so nothing moves when the answer lands.
 */
function ReadingPlaceholder() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="flex flex-col gap-[18px]">
      <SheetSection title={t('cerberus.sheet.lastHour')}>
        <div className="vv-skeleton h-[26px]" />
        <div className="h-[17px]" />
      </SheetSection>
      <SheetSection title={t('cerberus.lookup.title')}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="vv-skeleton h-9 w-44 flex-none" />
          <div className="vv-skeleton h-9 min-w-0 flex-[1_1_220px]" />
        </div>
      </SheetSection>
      <SheetSection title={t('cerberus.sheet.recorded')}>
        {[0, 1, 2].map((row) => <div key={row} className="vv-skeleton h-6" />)}
      </SheetSection>
    </div>
  );
}
