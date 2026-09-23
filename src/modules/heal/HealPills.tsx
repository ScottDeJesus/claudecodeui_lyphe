import { useTranslation } from 'react-i18next';

import { agoWord, statusTone, statusWord, usd } from '@/modules/heal/healState';
import { hasPreChangeRows } from '@/modules/heal/healTypes';
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
 * The instant the worker's own day began, in epoch seconds — its `spend_today` is summed from local
 * midnight, and the tab's midday questions ("is this figure one recipe's?") are about that same span,
 * so the two must cut the day the same way or the words describe a different set of rows.
 */
function midnightEpoch(now = Date.now()): number {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime() / 1000;
}

/**
 * The tab's vitals, in the operator's own order: friction since the last heal, what is ignored,
 * the last heal, today's DEEPSEEK spend against its cap — the landed dollars, and what the heals
 * still walking have reserved — and — fifth — the cycle: open, waiting, next at an hour, or the
 * schedule off.
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
 *
 * THE SPEND PILL NAMES A RECIPE ONLY WHEN THE DAY IS ONE. The landed figure is DeepSeek's share of
 * each heal only from 2026-09-23 — before that the ledger booked a chain's whole bill, Claude stages
 * included — so on the day that carries such a row the label drops to "Heal spend today" and the title
 * says what the figure mixes (`hasPreChangeRows`). And the reserved half is printed only when the
 * worker named it: an absent key is unknown, never a healthy zero.
 */
export function HealPills({ summary, activePill, onSelect }: HealPillsProps) {
  const { t } = useTranslation();
  const friction = summary.live_since_last_heal; // the cut this pill's title claims, never the whole ledger
  const ignored = summary.ignored;
  const lastHeal = summary.last_heal;
  const spend = summary.spend_today;
  // WHAT THE HEALS STILL WALKING HAVE YET TO BOOK. Read through `Number.isFinite`, because the worker
  // is the only side that can say it: a payload without the key (an older worker) leaves the reserved
  // half UNKNOWN, and unknown must never read as a healthy nothing — a reported 0 is a measurement, an
  // absent key is not one, and a NaN would fall through every comparison below into the calm tone.
  const reservedRaw = summary.spend_reserved;
  const reserved = Number.isFinite(reservedRaw) ? reservedRaw : null;
  const cap = summary.switches.daily_cap; // null is NO CEILING, the switch file absent and the shipped state
  // THE CAP IS DEEPSEEK'S, so this pill is about DeepSeek's money in both readings — but while Claude
  // is the effective model the ceiling cannot close anything, and a red pill over a cap nothing is
  // spending against would be this screen inventing a wall. The figure stays: today's DeepSeek spend is
  // still a fact the operator paid, and the words beside it name the side the cap does not count.
  const onClaude = summary.switches.model === 'claude';

  // WHAT THE DOOR ACTUALLY WEIGHS IS BOTH HALVES. A walking heal books its cost when it ENDS, so
  // `spend_today` alone under-reads a day with launches open (`read.tallies` reserves for them) — the
  // landed figure stays the number, the reserved one rides beside it whenever there is one, and the
  // tone is read off their sum, which is the figure `parked()` compares with the cap. Under the Claude
  // model nothing is reserved (a Claude heal books nothing this cap counts) and the reading is spend's.
  const weighed = onClaude || reserved === null ? spend : spend + reserved;
  const money = !onClaude && reserved !== null && reserved > 0 ? `${usd(spend)} + ${usd(reserved)}` : usd(spend);

  // Red only once the cap has actually closed the door; amber from 80% so the closing is seen coming.
  // Nothing is read off an unknown reserved half: this screen cannot say the cap is clear when the
  // worker has not named what the heals still walking hold.
  const spendTone: Tone = onClaude || reserved === null || cap === null ? 'neutral' : weighed >= cap ? 'danger' : weighed >= cap * 0.8 ? 'warn' : 'positive';

  // A DAY THAT STILL CARRIES A ROW BOOKED BEFORE THE RECIPE CHANGED is not DeepSeek's money, so the
  // pill may not say it is: those rows booked their chains' whole bills, Claude stages included. The
  // words drop the claim while any such card is on screen — the day of the change and no other — and
  // the title says what the figure mixes.
  const mixed = hasPreChangeRows(summary.heals, midnightEpoch());
  const mixedNote = t('heal.pills.spendNoteMixed', { defaultValue: 'Not DeepSeek’s dollars alone: the rows booked before 2026-09-23 booked their chain’s whole bill, Claude stages included, and the daily cap counts them all the same.' });
  const spendTitle = onClaude
    ? t('heal.pills.spendTitleClaude', { defaultValue: 'DeepSeek heal spend today. These heals run on Claude — your subscription — so the daily cap counts none of it and closes nothing.' })
    : reserved === null
      ? t('heal.pills.spendTitleUnknown', { defaultValue: 'DeepSeek heal spend today against the daily cap. The worker named no reserved figure, so the heals still walking are not in this number.' })
      : reserved > 0
        ? t('heal.pills.spendTitleReserved', { defaultValue: 'DeepSeek heal spend today: {{spent}} landed, {{reserved}} reserved for the heals still walking. The daily cap weighs both.', spent: usd(spend), reserved: usd(reserved) })
        : t('heal.pills.spendTitle', { defaultValue: 'DeepSeek heal spend today against the daily cap' });
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
      label: mixed
        ? t('heal.pills.spendMixed', { defaultValue: 'Heal spend today' })
        : t('heal.pills.spend', { defaultValue: 'DeepSeek today' }),
      value: onClaude
        ? `${usd(spend)} · ${t('heal.pills.noCapOnClaude', { defaultValue: 'no cap on Claude' })}`
        : cap === null ? `${money} · ${t('heal.pills.noCap', { defaultValue: 'no cap' })}` : `${money} / ${usd(cap)}`,
      tone: spendTone,
      title: mixed ? `${spendTitle} ${mixedNote}` : spendTitle,
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
