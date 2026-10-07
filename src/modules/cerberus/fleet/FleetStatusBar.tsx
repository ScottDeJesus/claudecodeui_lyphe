import { useTranslation } from 'react-i18next';

import { StatusCell } from '@/modules/cerberus/StatusMarks';
import { STATUS_TABLE } from '@/modules/cerberus/utils/cerberusStatus';
import type { CerberusStatus } from '@/shared/cerberus-types';
import type { FleetFilter, FleetFilterGroup, FleetGroup, Tone } from '@/shared/types';
import { cn } from '@/shared/utils';

/**
 * The bar's segments in the order they run, each in the look its nodes wear: passing the positive
 * wash, needs you the warn dot, updating the info dot (work in progress), muted the raised ground, no
 * result and nothing assigned an empty dashed box. Tone arrives only as `data-tone` and a `tone-*` name.
 */
const SEGMENTS: { group: FleetGroup; tone?: Tone; paint: string }[] = [
  { group: 'ok', tone: 'positive', paint: 'bg-tone-soft' },
  { group: 'needs', tone: 'warn', paint: 'bg-tone-dot' },
  { group: 'updating', tone: 'info', paint: 'bg-tone-dot' },
  { group: 'muted', paint: 'border border-input bg-muted' },
  { group: 'unknown', paint: 'border border-dashed border-ink-faint' },
  { group: 'empty', paint: 'border border-dashed border-input' },
];

/** Each group's words: in the line under the bar, and as its segment's tooltip. */
const WORDS: Record<FleetGroup, { line: string; tip: string }> = {
  ok: { line: 'cerberus.fleet.bar.passing', tip: 'cerberus.fleet.bar.passing' },
  needs: { line: 'cerberus.fleet.bar.needs', tip: 'cerberus.fleet.bar.needs' },
  updating: { line: 'cerberus.fleet.bar.updating', tip: 'cerberus.fleet.bar.updating' },
  muted: { line: 'cerberus.fleet.bar.muted', tip: 'cerberus.fleet.bar.muted' },
  unknown: { line: 'cerberus.fleet.bar.unknown', tip: 'cerberus.fleet.bar.unknown' },
  empty: { line: 'cerberus.fleet.bar.empty', tip: 'cerberus.fleet.bar.emptyTip' },
};

/** The order the line under the bar names the groups in: passing first, always, then each that holds a node. */
const LINE_ORDER: FleetGroup[] = ['ok', 'needs', 'unknown', 'muted', 'updating', 'empty'];

/**
 * THE FLEET AT A GLANCE: a bar split by how many nodes stand at each word, then the same in words
 * ("4 passing · 2 need you · 1 no result") and, on the right, what the list below holds ("6 nodes ·
 * worst first", or "Showing 80 of 96 · worst first" when it is paged). The bar is the whole fleet,
 * whatever is filtered; the right-hand note is the filtered list. The words carry everything the bar
 * draws, so the bar itself is hidden from assistive tech.
 *
 * Used by Fleet's `FleetView`, under the toolbar.
 */
export function FleetStatusBar({ groups, listed, drawn }: {
  /** Every filter with its live count (`filterGroups`); passing is All less the rest. */
  groups: FleetFilterGroup[];
  /** How many nodes the filter and the search hold. */
  listed: number;
  /** How many of them the page draws. */
  drawn: number;
}) {
  const { t } = useTranslation();
  const countOf = (group: FleetFilter): number => groups.find((entry) => entry.group === group)?.count ?? 0;
  const total = countOf('all');
  const counts: Record<FleetGroup, number> = {
    needs: countOf('needs'),
    unknown: countOf('unknown'),
    muted: countOf('muted'),
    updating: countOf('updating'),
    empty: countOf('empty'),
    ok: 0,
  };
  counts.ok = total - counts.needs - counts.unknown - counts.muted - counts.updating - counts.empty;

  const words = LINE_ORDER
    .filter((group) => group === 'ok' || counts[group] > 0)
    .map((group) => t(WORDS[group].line, { count: counts[group] }))
    .join(' · ');
  const note = listed === 0
    ? ''
    : drawn < listed ? t('cerberus.fleet.showing', { shown: drawn, total: listed }) : t('cerberus.fleet.nodes', { count: listed });

  return (
    <div className="flex flex-col gap-1.5">
      <div aria-hidden className="flex h-2 gap-0.5">
        {SEGMENTS.filter(({ group }) => counts[group] > 0).map(({ group, tone, paint }) => (
          <div
            key={group}
            data-tone={tone}
            title={t(WORDS[group].tip, { count: counts[group] })}
            style={{ width: `${(counts[group] / Math.max(total, 1)) * 100}%` }}
            className={cn('min-w-1 shrink rounded-[3px] transition-[width] duration-[600ms] ease-enter', paint)}
          />
        ))}
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <span>{words}</span>
        <span>{note}</span>
      </div>
    </div>
  );
}

/** The cells the legend names, in the order a strip turns worse; no result also stands for paused, which it draws the same. */
const LEGEND: CerberusStatus[] = ['ok', 'warn', 'failing', 'denied', 'muted', 'unknown', 'not_enabled'];

/**
 * THE KEY TO THE MINUTES: one cell of each look a strip can hold, with its word, and how to read the
 * fleet ("Squares are services · open a node for its last 30 minutes"). Each cell is drawn by the
 * same `StatusCell` the strips use, so the key can never drift from what it explains.
 *
 * Used by Fleet's `FleetView`, under the layout.
 */
export function FleetLegend() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-xs text-muted-foreground">
      {LEGEND.map((status) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <StatusCell status={status} aria-hidden className="h-3.5 w-[7px]" />
          {status === 'unknown' ? t('cerberus.fleet.legend.unknown') : t(STATUS_TABLE[status].wordKey)}
        </span>
      ))}
      <span className="ml-auto">{t('cerberus.fleet.legend.squares')}</span>
    </div>
  );
}
