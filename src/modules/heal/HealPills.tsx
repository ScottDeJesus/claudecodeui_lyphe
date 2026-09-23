import { useTranslation } from 'react-i18next';

import { agoWord, statusTone, statusWord, usd } from '@/modules/heal/healState';
import type { HealCycleState, HealPillKey, HealSummary } from '@/modules/heal/healTypes';
import type { Tone } from '@/shared/types';
import { Badge, Pill, PillBar } from '@/shared/ui';

type HealPillsProps = {
  summary: HealSummary;
  /** The pill last pressed, whose section the reader was carried to; null until one is. */
  activePill: HealPillKey | null;
  onSelect: (key: HealPillKey) => void;
};

/** `wrap` marks a value that is a sentence: it may break across lines on a phone, where a fixed pill would run off the edge. */
type PillSpec = { key: HealPillKey; label: string; value: string; tone: Tone; title: string; wrap?: boolean };

/** The worker's word as a tone: open is in motion, waiting is a reason to look, next and off are calm. */
const CYCLE_TONE: Record<HealCycleState['word'], Tone> = { open: 'info', waiting: 'warn', next: 'neutral', off: 'neutral' };

/**
 * The tab's vitals, in the operator's own order: friction since the last heal, what is ignored,
 * the last heal, today's spend against its cap, and — fifth — the cycle: open, waiting, next at an
 * hour, or the schedule off.
 *
 * FIVE NUMBERS AND NOTHING ELSE ABOVE THE FOLD. A reader who opens this tab on a phone sees these
 * before anything scrolls, and each answers one question in a tone that says whether to act:
 * amber friction is work waiting, red spend is a cap that has closed the door, an amber cycle is
 * one parked (the cap, DeepSeek's peak) or held by the master. Each pill is a press that carries the
 * reader to its section.
 *
 * THE CYCLE PILL RENDERS THE WORKER'S SENTENCE. `cycle_state.text` is Python's decision — which of
 * an open cycle, a refused schedule, the next slot or "off" wins — and this pill prints it, colours
 * it by `word`, and puts `at` in the reader's own clock in the title. It decides nothing.
 */
export function HealPills({ summary, activePill, onSelect }: HealPillsProps) {
  const { t } = useTranslation();
  const friction = summary.live_since_last_heal; // the cut this pill's title claims, never the whole ledger
  const ignored = summary.ignored;
  const lastHeal = summary.last_heal;
  const spend = summary.spend_today;
  const cap = summary.switches.daily_cap; // null is NO CEILING, the switch file absent and the shipped state
  // THE CAP IS DEEPSEEK'S, so this pill is about DeepSeek's money in both readings — but while Claude
  // is the effective model the ceiling cannot close anything, and a red pill over a cap nothing is
  // spending against would be this screen inventing a wall. The figure stays: today's DeepSeek spend is
  // still a fact the operator paid, and the words beside it name the side the cap does not count.
  const onClaude = summary.switches.model === 'claude';

  // Red only once the cap has actually closed the door; amber from 80% so the closing is seen coming.
  const spendTone: Tone = onClaude ? 'neutral' : cap === null ? 'neutral' : spend >= cap ? 'danger' : spend >= cap * 0.8 ? 'warn' : 'positive';
  const cycleState: HealCycleState = summary.cycle_state;

  const fifth: PillSpec = {
    key: 'cycle',
    label: t('heal.cycles.pill', { defaultValue: 'Cycle' }),
    value: cycleState.text,
    tone: CYCLE_TONE[cycleState.word],
    title: cycleState.at === null
      ? t('heal.cycles.pillOffTitle', { defaultValue: 'No cycle opens on its own; Run a cycle now opens one' })
      : new Date(cycleState.at * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
    wrap: true,
  };

  const pills: PillSpec[] = [
    {
      key: 'friction',
      label: t('heal.pills.friction', { defaultValue: 'Friction' }),
      value: String(friction),
      tone: friction > 0 ? 'warn' : 'positive',
      title: t('heal.pills.frictionTitle', { defaultValue: 'Live rows since the last heal' }),
    },
    {
      key: 'ignored',
      label: t('heal.pills.ignored', { defaultValue: 'Ignored' }),
      value: String(ignored),
      tone: 'neutral',
      title: t('heal.pills.ignoredTitle', { defaultValue: 'Rows an ignore row swept — refusals by design, never pain' }),
    },
    {
      key: 'lastHeal',
      label: t('heal.pills.lastHeal', { defaultValue: 'Last heal' }),
      // A last heal with no ending is still running: its word alone, since there is no "ago" yet.
      value: lastHeal === null
        ? t('heal.pills.noHeal', { defaultValue: 'none yet' })
        : lastHeal.ended_at === null
          ? statusWord(lastHeal.status)
          : `${statusWord(lastHeal.status)} · ${agoWord(lastHeal.ended_at)}`,
      tone: lastHeal ? statusTone(lastHeal.status) : 'neutral',
      title: lastHeal ? lastHeal.kind : t('heal.pills.noHealTitle', { defaultValue: 'No heal has run' }),
    },
    {
      key: 'spend',
      label: t('heal.pills.spend', { defaultValue: 'Today' }),
      value: onClaude
        ? `${usd(spend)} · ${t('heal.pills.noCapOnClaude', { defaultValue: 'no cap on Claude' })}`
        : cap === null ? `${usd(spend)} · ${t('heal.pills.noCap', { defaultValue: 'no cap' })}` : `${usd(spend)} / ${usd(cap)}`,
      tone: spendTone,
      title: onClaude
        ? t('heal.pills.spendTitleClaude', { defaultValue: 'DeepSeek heal spend today. These heals run on Claude — your subscription — so the daily cap counts none of it and closes nothing.' })
        : t('heal.pills.spendTitle', { defaultValue: 'Heal spend today against the daily cap' }),
    },
    fifth,
  ];

  return (
    // `flex-wrap` on the bar: five pills do not fit a phone in one row, and a stats row that
    // scrolls sideways hides the one number that would have said "act".
    <PillBar className="w-full flex-wrap" role="group" aria-label={t('heal.pills.label', { defaultValue: 'Heal vitals' })} data-heal-pills>
      {pills.map((pill) => (
        <Pill
          key={pill.key}
          isActive={activePill === pill.key}
          onClick={() => onSelect(pill.key)}
          title={pill.title}
          // A sentence-valued pill may shrink and wrap; a number-valued one keeps its one line.
          className={pill.wrap ? 'min-w-0 max-w-full shrink text-left' : undefined}
          data-heal-pill={pill.key}
        >
          <span className="text-xs">{pill.label}</span>
          <Badge as="span" tone={pill.tone} className={pill.wrap ? 'min-w-0 whitespace-normal break-words' : undefined}>{pill.value}</Badge>
        </Pill>
      ))}
    </PillBar>
  );
}
