import { ChevronRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { agoWord, clockWord, usd } from '@/modules/heal/healState';
import type { HealCycle, HealCycleItem, HealCycleNotes, HealCycleState, HealCycleTier } from '@/modules/heal/healTypes';
import type { Tone } from '@/shared/types';
import { Badge, Banner, Chip, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * Cycles — what the nightly maintenance did and what a pressed Start is doing now — ABOVE the heals,
 * because a cycle is the unit the operator asks about ("what did last night do?") and a heal is one
 * line of its worklist.
 *
 * ONE CARD PER CYCLE, THE OPEN ONE STANDING OPEN. A closed cycle is one line — door, stage, when, its
 * four tallies — so ten of them read as a ledger and not a wall, and it opens to its worklist. The
 * open cycle is already open, because the thing in motion is the thing being watched, and its waiting
 * reason (a park — the cap or DeepSeek's peak — or the master off) is a banner and not a footnote: it
 * is the one answer to "why is nothing happening". A walk elsewhere never parks a cycle.
 *
 * THE WORKLIST IS CHIRON'S ORDER AND THE WORKER'S RANK. Nothing here re-sorts: the payload's order is
 * the order drawn, and `item.label` is printed as the worker wrote it. Colour is the tier — red for a
 * regression (a shape came back), blue for a frequent kind, grey for a one-off — and the state chip
 * says what became of it. `spent` is DeepSeek dollars and shows only
 * above zero: Claude is a subscription, and a dollar figure on a Claude cycle would be an invented cost.
 *
 * With no cycle yet the empty line carries the worker's own sentence on what comes next
 * (`cycle_state.text` — "Next cycle 10:00 UTC", "Schedule off").
 */
export function HealCycleList({ cycles, cycleState }: { cycles: HealCycle[]; cycleState: HealCycleState }) {
  const { t } = useTranslation();
  const shown = cycles;
  return (
    <section aria-labelledby="heal-cycles-title" className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3" data-heal-cycles>
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 id="heal-cycles-title" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('heal.cycles.title', { defaultValue: 'Cycles' })}
        </h4>
        {shown.length > 0 && <Badge as="span" tone="neutral">{shown.length}</Badge>}
        <span className="text-xs text-muted-foreground">· {t('heal.cycles.hint', { defaultValue: 'a press opens one — Chiron ranks, heals walk his list' })}</span>
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-heal-cycles-empty>
          {t('heal.cycles.empty', { defaultValue: 'No cycles yet' })}
          {` · ${cycleState.text}`}
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {shown.map((cycle) => <CycleCard key={cycle.id} cycle={cycle} />)}
        </ul>
      )}
    </section>
  );
}

const OPEN_STAGES: HealCycle['stage'][] = ['judging', 'healing', 'closing'];

/** A cycle in motion is blue; one that landed is green; one the operator stopped is grey — waiting by his word. */
function stageTone(stage: HealCycle['stage']): Tone {
  if (stage === 'done') return 'positive';
  if (stage === 'stopped') return 'neutral';
  return 'info';
}

const TIER_TONE: Record<HealCycleTier, Tone> = { regression: 'danger', frequent: 'info', 'one-off': 'neutral' };

/** Landed is green only when the heal it names landed `done`; a heal the ledger reads as `gone`, stopped or failed is amber. */
function itemTone(item: HealCycleItem): Tone {
  if (item.state === 'launched') return 'info';
  if (item.state === 'landed') return item.note === 'done' ? 'positive' : 'warn';
  return 'neutral';
}

type Translate = ReturnType<typeof useTranslation>['t'];

/** Chiron's part in one badge: not launched, judging, ranked, a fallback with its reason, or nothing to judge. */
function chironLine(cycle: HealCycle, t: Translate): { tone: Tone; text: string; title?: string } {
  const judge = cycle.judge;
  if (judge === null) return { tone: 'neutral', text: t('heal.cycles.chironPending', { defaultValue: 'Chiron · not launched yet' }) };
  if (judge.startsWith('fallback: ')) return { tone: 'warn', text: t('heal.cycles.chironFallback', { defaultValue: 'Chiron · fallback — {{why}}', why: judge.slice('fallback: '.length) }) };
  if (judge.startsWith('none')) return { tone: 'neutral', text: t('heal.cycles.chironNone', { defaultValue: 'Chiron · nothing to judge' }) };
  if (cycle.stage === 'judging') return { tone: 'info', text: t('heal.cycles.chironJudging', { defaultValue: 'Chiron · judging' }), title: judge };
  return { tone: 'positive', text: t('heal.cycles.chironRanked', { defaultValue: 'Chiron · ranked {{count}}', count: cycle.items.length }), title: judge };
}

function CycleCard({ cycle }: { cycle: HealCycle }) {
  const { t } = useTranslation();
  const open = OPEN_STAGES.includes(cycle.stage);
  const door = cycle.door === 'schedule'
    ? t('heal.cycles.nightly', { defaultValue: 'Nightly' })
    : t('heal.cycles.pressed', { defaultValue: 'Pressed' });
  const chiron = chironLine(cycle, t);

  return (
    <li className="min-w-0 rounded-lg border border-border" data-heal-cycle={cycle.id} data-heal-cycle-stage={cycle.stage}>
      <Collapsible defaultOpen={open} className="min-w-0">
        {/* The whole line is the press, the kind rows' own shape; everything inside is a span, so nothing pressable nests. */}
        <CollapsibleTrigger
          className="group flex min-h-11 w-full min-w-0 flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted"
          aria-label={t('heal.cycles.toggle', { defaultValue: 'Show the worklist of the {{door}} cycle started {{ago}}', door, ago: agoWord(cycle.started_at) })}
        >
          <ChevronRightIcon className="h-4 w-4 flex-none text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" aria-hidden="true" />
          <span className="text-sm font-medium">{door}</span>
          <Badge as="span" tone={stageTone(cycle.stage)}>{cycle.stage}</Badge>
          <span className="font-mono text-xs text-muted-foreground" title={new Date(cycle.started_at * 1000).toLocaleString()}>
            {clockWord(cycle.started_at)} · {agoWord(cycle.started_at)}
          </span>
          {cycle.ended_at !== null && (
            <span className="text-xs text-muted-foreground">{t('heal.cycles.ended', { defaultValue: 'ended {{ago}}', ago: agoWord(cycle.ended_at) })}</span>
          )}
          {/* The tallies keep the far end, so a column of closed cycles reads as a table. */}
          <span className="ml-auto flex flex-wrap items-center gap-1.5 text-xs" data-heal-cycle-stats>
            <Badge as="span" tone="neutral">{t('heal.cycles.gathered', { defaultValue: '{{count}} gathered', count: cycle.gathered })}</Badge>
            <Badge as="span" tone="neutral">{t('heal.cycles.ignored', { defaultValue: '{{count}} ignored', count: cycle.ignored })}</Badge>
            <Badge as="span" tone={cycle.healed > 0 ? 'positive' : 'neutral'}>{t('heal.cycles.healed', { defaultValue: '{{count}} healed', count: cycle.healed })}</Badge>
            {cycle.spent > 0 && (
              <span className="font-mono text-muted-foreground" title={t('heal.cycles.spentTitle', { defaultValue: 'DeepSeek dollars this cycle spent — a heal that landed before 2026-09-23 booked its chain’s whole bill, Claude stages included, so a cycle spanning that date counts more than DeepSeek billed' })}>{usd(cycle.spent)}</span>
            )}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="min-w-0">
          <div className="flex min-w-0 flex-col gap-2 border-t border-border px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
              <Badge as="span" tone={chiron.tone} title={chiron.title}>{chiron.text}</Badge>
              {cycle.end_reason !== null && cycle.end_reason !== 'done' && <Badge as="span" tone="neutral">{cycle.end_reason}</Badge>}
            </div>
            {open && cycle.wait !== null && (
              <Banner tone="warn">
                <span className="text-xs" data-heal-cycle-wait>{t('heal.cycles.waiting', { defaultValue: 'Waiting: {{why}}', why: cycle.wait })}</span>
              </Banner>
            )}
            {cycle.items.length > 0 && (
              <ol className="flex min-w-0 flex-col divide-y divide-border rounded-lg border border-border" data-heal-cycle-items>
                {cycle.items.map((item) => <ItemRow key={item.ref} item={item} />)}
              </ol>
            )}
            <JudgeNotes notes={cycle.notes} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/** One line of the worklist: the rank, the label as written, the tier, what became of it, and Chiron's why. */
function ItemRow({ item }: { item: HealCycleItem }) {
  const set = item.state === 'dropped' || item.state === 'ignored' || item.state === 'skipped';
  return (
    <li className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs', set && 'text-muted-foreground')} data-heal-cycle-item={item.ref}>
      <span className="w-5 flex-none font-mono text-muted-foreground">{item.rank}</span>
      <span className="min-w-0 break-words font-mono">{item.label}</span>
      <Chip size="sm" tone={TIER_TONE[item.tier]}>{item.tier}</Chip>
      <Badge as="span" tone={itemTone(item)}>{item.state}</Badge>
      {/* A dropped item's note IS its why; printing it twice says nothing more. */}
      {item.note !== '' && item.note !== item.why && <span className="min-w-0 break-words text-muted-foreground">{item.note}</span>}
      <span className="w-full min-w-0 break-words leading-snug">{item.why}</span>
    </li>
  );
}

/** `Write: Sandbox refused Write to /proc` for an entry shaped like an ignore row; anything else as it came. */
function entryWord(entry: unknown): string {
  if (entry !== null && typeof entry === 'object' && 'pattern' in entry) {
    const row = entry as { tool?: unknown; pattern?: unknown };
    return `${String(row.tool ?? '*')}: ${String(row.pattern ?? '')}`;
  }
  return JSON.stringify(entry);
}

/** What Chiron's ignore entries did — the ones applied, with their sweep, and the ones refused, with why. */
function JudgeNotes({ notes }: { notes: HealCycleNotes }) {
  const { t } = useTranslation();
  if (notes.ignored.length === 0 && notes.refused.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1 text-xs" data-heal-cycle-notes>
      {notes.ignored.map((entry, index) => (
        <div key={`i${index}`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <Badge as="span" tone="neutral">{t('heal.cycles.ignoredEntry', { defaultValue: 'ignored · {{count}} swept', count: entry.swept })}</Badge>
          <code className="min-w-0 break-all font-mono">{entry.tool}: {entry.pattern}</code>
          <span className="min-w-0 break-words text-muted-foreground">{entry.reason}</span>
        </div>
      ))}
      {notes.refused.map((entry, index) => (
        <div key={`r${index}`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5" data-heal-cycle-refused>
          <Badge as="span" tone="warn">{t('heal.cycles.refusedEntry', { defaultValue: 'ignore refused' })}</Badge>
          <code className="min-w-0 break-all font-mono">{entryWord(entry.entry)}</code>
          <span className="min-w-0 break-words text-muted-foreground">{entry.why}</span>
        </div>
      ))}
    </div>
  );
}
