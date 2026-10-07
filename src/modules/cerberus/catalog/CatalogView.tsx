import type { TFunction } from 'i18next';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { useClock } from '@/modules/cerberus/hooks/useClock';
import { UnreachableBanner } from '@/modules/cerberus/UnreachableBanner';
import { hm, sameLocalDay } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusCatalogEntryView } from '@/shared/cerberus-types';
import { Badge, Button, Card, Switch } from '@/shared/ui';
import { cn, formatShortDate } from '@/shared/utils';

/** How long an entry reads as new after it is added: its "New · HH:MM" and its wash. */
const NEW_FOR_MS = 3_600_000;

/** The rows' stagger, the prototype's 45 ms a row, capped so a long catalog is not still arriving seconds later. */
const STAGGER_MS = 45;
const STAGGER_ROWS = 12;

/** A moment as its time when it is on `now`'s local day ("09:14"), else as its short date ("Sep 12"). */
function dayOrTime(ms: number, now: number): string {
  return sameLocalDay(ms, now) ? hm(ms) : formatShortDate(new Date(ms).toISOString()) ?? hm(ms);
}

/** "3 runs · all succeeded", "3 runs · 2 succeeded" or "Never run": the runs that have ended, and how many succeeded. */
function statsLine(t: TFunction, { runs, ok }: CerberusCatalogEntryView['stats']): string {
  if (runs === 0) return t('cerberus.catalog.stats.never');
  return ok === runs
    ? t('cerberus.catalog.stats.allOk', { count: runs })
    : t('cerberus.catalog.stats.someOk', { count: runs, ok });
}

/** "Written by you · Sep 12 · last run 09:14", or "Promoted from a diagnosis · 17:40" for an entry a diagnosis became. */
function originLine(t: TFunction, entry: CerberusCatalogEntryView, now: number): string {
  const date = dayOrTime(entry.origin.at, now);
  const origin = entry.origin.kind === 'written'
    ? t('cerberus.catalog.origin.written', { date })
    : t('cerberus.catalog.origin.diagnosis', { date });
  return entry.stats.lastRunAt === null
    ? origin
    : t('cerberus.catalog.origin.lastRun', { origin, time: dayOrTime(entry.stats.lastRunAt, now) });
}

/** "Runs on its own · at most 2 runs an hour" (`limit.per` is an hour or a day), or "Off · offered, you press it". */
function autoLine(t: TFunction, { auto, limit }: CerberusCatalogEntryView): string {
  if (!auto) return t('cerberus.catalog.auto.off');
  return t('cerberus.catalog.auto.on', { count: limit.runs, context: limit.per === 86_400 ? 'day' : 'hour' });
}

type EntryRowProps = {
  entry: CerberusCatalogEntryView;
  /** Its place in the list, for the stagger. */
  index: number;
  /** Added within the hour: "New · HH:MM" beside its name, and the positive wash under the row. */
  isNew: boolean;
  /** A run of this entry is going, or its Run press is still out: the button reads "Running…" and takes no press. */
  busy: boolean;
  /** Another run is going on the same check, which center would refuse a second one for. */
  blocked: boolean;
  now: number;
  onAuto: (entry: CerberusCatalogEntryView, on: boolean) => void;
  onRun: (entry: CerberusCatalogEntryView) => void;
};

/**
 * One entry: what it is and when it runs, what it has done, how it runs, and Run now.
 *
 * Left, the name (with "New · 17:40" for its first hour), then the trigger in words ("Disk has room nears
 * its limit · Supabase on eis1") over its raw key and `when`, then the command after a `$`. A check with no
 * label yet is named by its key, in mono, which then is not written a second time under it. Middle, the
 * runs ("14 runs · all succeeded") and where the entry came from. Right, the switch and what it means now
 * — or, for a capped entry, the reason it never runs on its own, in neutral, with no switch. Last, Run now.
 *
 * The trigger's check name and service are a person's own words, so they reach the screen as text through
 * `t()`, never through `Trans`, which escapes a `<` in them ("p95 < 300 ms") to protect its own tags.
 *
 * "Running…" keeps the button in the tab order (`aria-disabled`, never `disabled`): a real `disabled`
 * blurs the button the moment it is set, and the person who pressed Run now with Enter would have to Tab
 * back from the top. A run of ANOTHER entry on the same check disables it outright, since center refuses
 * a second run on a check (`CERBERUS_RUN_ACTIVE`), and says so under how the entry runs, where a phone
 * shows it too: the run holding the check may be far down the list, or a diagnosis's with no row at all.
 */
function EntryRow({ entry, index, isNew, busy, blocked, now, onAuto, onRun }: EntryRowProps) {
  const { t } = useTranslation();
  const reasonId = useId();
  const service = entry.serviceLabel ?? entry.check.slice(0, entry.check.indexOf('/'));
  // Why Run now takes no press when another run holds the check; the button names it as its description.
  const held = blocked && !busy;
  const heldNote = held ? <p id={reasonId} className="text-xs text-muted-foreground">{t('cerberus.catalog.blocked')}</p> : null;

  return (
    <li
      data-tone={isNew ? 'positive' : undefined}
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border px-5 py-4 first:border-t-0 motion-safe:animate-shape-rise',
        isNew && 'bg-tone-soft/70',
      )}
      style={{ animationDelay: `${Math.min(index, STAGGER_ROWS) * STAGGER_MS}ms` }}
    >
      <div className="flex min-w-0 flex-[2_1_250px] flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-medium [overflow-wrap:anywhere]">{entry.name}</h2>
          {isNew && (
            <span className="inline-block motion-safe:animate-cerberus-check" style={{ animationDelay: '200ms' }}>
              <Badge tone="positive">{t('cerberus.catalog.new', { time: hm(entry.createdAt) })}</Badge>
            </span>
          )}
        </div>
        <p className="text-[13px] text-muted-foreground">
          {entry.checkLabel ?? <span className="font-mono text-[12px] [overflow-wrap:anywhere]">{entry.check}</span>}{' '}
          {t(`cerberus.catalog.trigger.${entry.when}`, { service, node: entry.node })}
        </p>
        {entry.checkLabel !== null && (
          <p className="font-mono text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">
            {t('cerberus.catalog.raw', { key: entry.check, when: entry.when })}
          </p>
        )}
        <p className="font-mono text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">{t('cerberus.fix.command', { cmd: entry.cmd })}</p>
      </div>

      <div className="min-w-0 flex-[1_1_150px] text-[12.5px] tabular-nums text-muted-foreground">
        <p>{statsLine(t, entry.stats)}</p>
        <p className="text-xs">{originLine(t, entry, now)}</p>
      </div>

      <div className="flex min-w-0 flex-[1_1_200px] items-center gap-3">
        {entry.capped === null ? (
          <>
            <Switch checked={entry.auto} onChange={(on) => onAuto(entry, on)} label={t('cerberus.catalog.auto.label', { name: entry.name })} />
            <div className="min-w-0">
              <p className="text-[12.5px] text-secondary-foreground">{autoLine(t, entry)}</p>
              {heldNote}
            </div>
          </>
        ) : (
          <div className="flex min-w-0 flex-col items-start gap-1">
            <p data-tone="neutral" className="rounded-lg bg-tone-soft px-2.5 py-1.5 text-[12.5px] text-secondary-foreground">{entry.capped}</p>
            {heldNote}
          </div>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        disabled={held}
        aria-disabled={busy || undefined}
        aria-describedby={held ? reasonId : undefined}
        // One width for both words, so the columns stand in line down the catalog whichever a row reads.
        className={cn('min-w-24', busy && 'cursor-not-allowed opacity-70')}
        onClick={busy ? undefined : () => onRun(entry)}
      >
        {busy ? t('cerberus.catalog.running') : t('cerberus.catalog.runNow')}
      </Button>
    </li>
  );
}

/** The rows' shapes, shimmering, while the catalog's first read is out. */
function ReadingRows() {
  return (
    <ul aria-busy="true">
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border px-5 py-4 first:border-t-0">
          <div className="flex min-w-0 flex-[2_1_250px] flex-col gap-1.5">
            <div className="vv-skeleton h-[18px] w-3/5" />
            <div className="vv-skeleton h-3.5 w-4/5" />
            <div className="vv-skeleton h-3 w-2/3" />
          </div>
          <div className="flex min-w-0 flex-[1_1_150px] flex-col gap-1.5">
            <div className="vv-skeleton h-3.5 w-28" />
            <div className="vv-skeleton h-3 w-40" />
          </div>
          <div className="flex min-w-0 flex-[1_1_200px] items-center gap-3">
            <div className="vv-skeleton h-[30px] w-[52px] flex-none rounded-full" />
            <div className="vv-skeleton h-3.5 w-36" />
          </div>
          <div className="vv-skeleton h-9 w-[86px] flex-none" />
        </li>
      ))}
    </ul>
  );
}

/**
 * THE CATALOG: the fixes Cerberus can offer, or run on its own (`design/cerberus/Cerberus Tab.dc.html`
 * :301-336). The tab's third view, between Fleet and History.
 *
 * Read top to bottom: what an entry is (one sentence each for offering, running on its own within a
 * limit, kept output and the steps that stay a person's), "7 entries · 2 run on their own", and the
 * entries newest first, so one just added stands at the top with its wash.
 *
 * Until the first read answers, three shimmering rows; when it failed, "Cerberus can't be reached" with
 * Try again; with nothing written yet, one line saying so.
 *
 * For the cerberus module's `CerberusPanel`, which draws it as the Catalog tab.
 */
export function CatalogView() {
  const { t } = useTranslation();
  // The catalog the provider reads with the overview (null until it first answers, `failed` when that read
  // did not), every run not yet ended, and the entry whose Run press is still out.
  const { catalog: entries, catalogFailed: failed, overview, starting, setAuto, runEntry, refresh } = useCerberus();
  const running = overview?.running ?? [];
  // A minute is fine grain for an hour's wash: an entry stops being new within a minute of its hour's end.
  const now = useClock(60_000);
  // Setting auto-run refreshes the catalog; a capped entry has no switch, and a refusal toasts itself.
  const onAuto = (entry: CerberusCatalogEntryView, on: boolean) => {
    void setAuto(entry.id, on);
  };
  // The row reads "Running…" from the press until its run ends (`starting`, then the overview's `running`).
  const onRun = (entry: CerberusCatalogEntryView) => {
    void runEntry(entry.id);
  };
  // The provider's read brings the catalog with the overview.
  const onRetry = () => {
    void refresh();
  };

  const ordered = entries === null ? null : [...entries].sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name));
  const autoCount = entries?.filter((entry) => entry.auto).length ?? 0;

  let body;
  if (ordered === null) body = failed ? <div className="p-4"><UnreachableBanner onRetry={onRetry} /></div> : <ReadingRows />;
  else if (ordered.length === 0) body = <p className="px-5 py-4 text-[13.5px] text-muted-foreground">{t('cerberus.catalog.empty')}</p>;
  else body = (
    <ul>
      {ordered.map((entry, index) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          index={index}
          isNew={now - entry.createdAt < NEW_FOR_MS}
          busy={starting.includes(entry.id) || running.some((run) => run.entry === entry.id)}
          blocked={running.some((run) => run.node === entry.node && run.check === entry.check)}
          now={now}
          onAuto={onAuto}
          onRun={onRun}
        />
      ))}
    </ul>
  );

  return (
    <div className="flex max-w-[1180px] flex-col gap-3.5 px-[clamp(16px,4cqi,32px)] pb-7 pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="max-w-[680px] text-pretty text-[13.5px] text-muted-foreground">{t('cerberus.catalog.intro')}</p>
        {entries !== null && (
          <p className="text-[12.5px] text-muted-foreground">{t('cerberus.catalog.count', { count: entries.length, auto: autoCount })}</p>
        )}
      </div>
      <Card className="overflow-hidden">{body}</Card>
    </div>
  );
}
