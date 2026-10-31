import { Focus, Inbox, LayoutList, MessageCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cloneElement, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionActionLine, CompanionTalkButton } from '@/modules/companion';
import { useStripWeek } from '@/modules/station/hooks/useStripWeek';
import { StationSectionsView } from '@/modules/station/StationSections';
import type { CompanionPendingAction } from '@/shared/companion-types';
import { STATION_OUT_OF_REACH as UNDER_THE_WEEK, STATION_SIDEWAYS_CATCH } from '@/shared/constants';
import type { StationCompactSection, StationHeadRow, StationSlot, TalkPress } from '@/shared/types';
import { Badge, Button } from '@/shared/ui';
import { cn, isDrawn } from '@/shared/utils';

/** The bar's sections either side of the round talk control, so it stands at the bar's center: all four drawn always. */
const BAR_LEFT: readonly StationCompactSection[] = ['conversation', 'needs'];
const BAR_RIGHT: readonly StationCompactSection[] = ['where', 'stage'];

/** Each section's glyph in the bar, always beside its word (MAN-578): her conversation, what needs him, his work, the stage's own. */
const GLYPHS: Record<StationCompactSection, LucideIcon> = { conversation: MessageCircle, needs: Inbox, where: LayoutList, stage: Focus };

/** Her head as the arrangement draws it: its own element, handed the row (as the sections hand their regions their density). */
function headAs(node: ReactNode, row: StationHeadRow): ReactNode {
  return isValidElement<{ row?: StationHeadRow }>(node) ? cloneElement(node, { row }) : node;
}

type StationPhoneViewProps = {
  /** Her head: the `head` slot's region at compact density (`StationHead`), handed its row here (`StationHeadRow`). */
  head: ReactNode;
  /** The strip's folded line (`useStripWeek`): a row of its own under the top row upright, the top row's end on its side. */
  strip: ReactNode;
  /** The strip's whole week, opened over the middle by the line's fold (`useStripWeek`); null while shut. */
  openStrip: ReactNode;
  /** The middle: `StationSectionsView` at compact density, showing `section`. */
  middle: ReactNode;
  /** The action waiting for his word in one line (`CompanionActionLine`), its press selecting Needs you; null while none waits. */
  pendingLine: ReactNode;
  /** The section the middle shows, `aria-current` in the bar. */
  section: StationCompactSection;
  /** A section chosen: by the bar, or by the count of what needs him (Needs you). */
  onSection: (next: StationCompactSection) => void;
  /** How many things need him: the rail's items and her pending action. Null until the first read has landed: then no number, never "0". */
  needsCount: number | null;
  /** The label of what stands on the stage, the Stage press's word; null while the stage is empty, when the word is "Stage". */
  focusLabel: string | null;
  /** The page's one talk press, drawn round at the bar's center, and her name, which names it ("Talk to Kaylee"). */
  talk: { press: TalkPress; name: string };
  /** The phone on its side: the top row 40 px with the strip's line at its end, the bar 48 px, the round control's sideways step. */
  sideways: boolean;
  /** "CloudCLI" in her menu, the shell's way back in the same window. */
  onBackToCloudcli: () => void;
};

/**
 * THE PHONE'S ARRANGEMENT, the station made for the thumb, inside the shell's frame (status bar, notch and keyboard cleared; the
 * bar clears the home indicator itself). Compact's one column arranged for the glass: its sections and the regions' compact
 * density, with the presses at the bottom and her face and state at the top. Top to bottom:
 *
 * 1. THE TOP ROW, the bar and her head in one (her head's `row`, `HeadRow`): her face at 44 px, her name and state on one line,
 *    the count of what needs him (a press to Needs you), and her ONE menu, her controls over "CloudCLI". No station title: her
 *    name stands there. Her face is never covered: everything this arrangement lays over anything opens under the row.
 * 2. THE STRIP'S LINE, "<n> new" and the newest landing. Its fold opens the whole week OVER the middle, laid from the line's own
 *    top over the line, whole and inert under it, and on as far as it runs; the week's own fold, or a landing put on the stage,
 *    shuts it. It is a box of this arrangement, never a full-screen overlay: it takes no `pwa-status-clear`.
 * 3. THE MIDDLE: the section held (`StationSectionsView`), each scroller inside it held to itself (`overscroll-contain`), so a
 *    swipe that reaches a list's end never rubber-bands the page. TAPS ONLY: no swipe moves between sections (the edge swipe is
 *    the browser's Back, and the cards scroll sideways).
 * 4. THE PENDING LINE, only while an action waits for his word (`CompanionActionLine`): the card's head, its action and its
 *    lapse, never his lines; its press selects Needs you, where the whole card stands with them word for word (MAN-9186).
 * 5. THE BOTTOM BAR, padded by the home indicator's inset: Conversation · Needs you · the round talk control · Where things
 *    stand · Stage, each section a glyph AND its word, the one shown filled and `aria-current`, all four drawn always so the talk
 *    control keeps the center. Needs you carries its count; Stage's word is the label of what stands there ("Stage" with nothing).
 *    The talk control is the page's one press (`CompanionTalkButton`, round, 64 px): Conversation's box to type to her has no
 *    talk button of its own. What failed with the last press stands in words just above the bar, in the flow, covering nothing.
 *
 * WHILE THE KEYBOARD IS UP (`data-keyboard="up"` on html): the frame ends at the keys and the pending line, the talk error and the
 * bar step aside, so the box to type to her sits on the keyboard as a phone's own messaging does. The middle is the size container
 * `station-column`, compact's name, so the sections fold for the keys here as they do there.
 *
 * ON ITS SIDE (`sideways`): the top row 40 px with her face at 32 px and the strip's line folded into its end, before the count;
 * the week opens over the middle's top; the bar 48 px with the talk control at its 52 px step; the middle takes the rest.
 *
 * THE TOUCH LAW: every press here is a 44 px catch, on its side included (the top row's by a catch grown past its 40 px). Nothing
 * is said only on hover: each section's word is drawn, the count's words are its name.
 *
 * `data-station-phone` reads the section shown and `data-station-phone-form` the form. A pure view: `StationPhone` below binds it,
 * and `.verify/kaylee-station-shots.mjs` draws it on the fixtures' pictures, a section per picture, as the home-screen app.
 */
export function StationPhoneView({
  head, strip, openStrip, middle, pendingLine, section, onSection, needsCount, focusLabel, talk, sideways, onBackToCloudcli,
}: StationPhoneViewProps) {
  const { t } = useTranslation();
  const weekOpen = isDrawn(openStrip);

  const words: Record<StationCompactSection, string> = {
    conversation: t('station.compact.section.conversation', { defaultValue: 'Conversation' }),
    needs: t('station.compact.section.needs', { defaultValue: 'Needs you' }),
    where: t('station.compact.section.where', { defaultValue: 'Where things stand' }),
    stage: t('station.compact.section.stage', { defaultValue: 'Stage' }),
  };
  // Before the first read lands the count claims nothing: "Nothing needs you" is a read's answer, and none has come (or it failed).
  const needsName = needsCount === null
    ? t('station.compact.needsPressUnread', { defaultValue: 'Open Needs you' })
    : t('station.compact.needsPress', { count: needsCount, defaultValue: '{{count}} need you: open Needs you' });
  const waiting = needsCount !== null && needsCount > 0 ? needsCount : null;

  const count = (
    <Button
      variant="outline"
      size="sm"
      data-station-phone-needs={needsCount ?? 'unread'}
      aria-label={needsName}
      className={cn('min-w-11 shrink-0 px-2.5', sideways ? STATION_SIDEWAYS_CATCH : 'h-11')}
      onClick={() => onSection('needs')}
    >
      <Inbox aria-hidden="true" />
      {needsCount === null ? null : waiting !== null ? (
        <Badge as="span" tone="warn" className="tabular-nums">{waiting}</Badge>
      ) : (
        <span className="tabular-nums text-muted-foreground">0</span>
      )}
    </Button>
  );
  // On its side the strip's line stands at the top row's end, before the count, and gives way first: her state keeps its words.
  const sideStrip = sideways && isDrawn(strip) && (
    <div data-station-slot="strip" className="flex min-w-48 max-w-96 flex-[0_100_24rem]">{strip}</div>
  );
  const week = weekOpen && (
    <div
      data-station-phone-week=""
      className={cn('absolute inset-x-0 top-0 z-10 flex min-w-0 items-start border-b border-border bg-background px-3 py-1.5 shadow-lift', !sideways && 'min-h-full')}
    >
      {openStrip}
    </div>
  );

  // One section's press in the bar: its glyph over its word (beside it on its side), the shown one filled.
  const pressOf = (name: StationCompactSection) => {
    const shown = name === section;
    const Glyph = GLYPHS[name];
    const counted = name === 'needs' ? waiting : null;
    const word = name === 'stage' && focusLabel !== null ? focusLabel : words[name];
    // Where the word drawn is not the section's own (a count beside it, a label in its place), the name says both.
    const label = name === 'stage' && focusLabel !== null
      ? t('station.phone.stagePress', { label: focusLabel, defaultValue: 'Stage: {{label}}' })
      : counted !== null ? t('station.phone.needsPress', { count: counted, defaultValue: 'Needs you · {{count}}' }) : undefined;
    return (
      <Button
        key={name}
        variant={shown ? 'tonal' : 'ghost'}
        aria-current={shown ? 'true' : undefined}
        aria-label={label}
        data-station-phone-section={name}
        className={cn(
          'min-w-0 rounded-xl px-1 leading-tight [&_svg]:size-5',
          sideways ? 'h-11 gap-1.5 text-xs' : 'h-full flex-col justify-start gap-1 pt-2 text-[11px]',
          !shown && 'text-muted-foreground',
        )}
        onClick={() => onSection(name)}
      >
        <span className="relative flex shrink-0">
          <Glyph aria-hidden="true" />
          {counted !== null && (
            <Badge as="span" tone="warn" className="vv-badge--compact absolute -right-3 -top-2 tabular-nums">{counted}</Badge>
          )}
        </span>
        <span className={cn('min-w-0', sideways ? 'truncate' : 'line-clamp-2 whitespace-normal text-center')}>{word}</span>
      </Button>
    );
  };

  return (
    <div
      data-station-phone={section}
      data-station-phone-form={sideways ? 'sideways' : 'upright'}
      className="flex min-h-0 w-full flex-1 flex-col [container-name:station-column] [container-type:size]"
    >
      <div data-station-phone-top="" className="relative z-[1] shrink-0 border-b border-border bg-background">
        <div data-station-slot="head" className="min-w-0">
          {headAs(head, { sideways, onBackToCloudcli, trail: <>{sideStrip}{count}</> })}
        </div>
      </div>

      {!sideways && isDrawn(strip) && (
        <div className="relative shrink-0">
          <div data-station-phone-strip={weekOpen ? 'open' : 'line'} className="border-b border-border">
            <div data-station-slot="strip" {...(weekOpen ? UNDER_THE_WEEK : null)} className="flex min-w-0 px-3 py-1">{strip}</div>
          </div>
          {week}
        </div>
      )}

      <div data-station-phone-middle="" className="relative flex min-h-0 flex-1 flex-col [&_*]:overscroll-contain">
        {middle}
        {sideways && week}
      </div>

      <div data-station-phone-foot="" className="shrink-0 [html[data-keyboard=up]_&]:hidden">
        {isDrawn(pendingLine) && <div data-station-phone-pending="">{pendingLine}</div>}
        {talk.press.error !== null && (
          <div className="flex justify-center px-3 py-1.5">
            <p
              role="alert"
              data-tone="warn"
              data-station-phone-talk-error=""
              className="flex w-fit items-start gap-1.5 rounded-lg border border-tone-ink/25 bg-tone-soft px-2.5 py-1.5 text-xs leading-snug text-tone-ink"
            >
              <span aria-hidden="true">▲</span>
              <span className="min-w-0 break-words">{talk.press.error}</span>
            </p>
          </div>
        )}
        <nav
          data-station-phone-bar=""
          aria-label={t('station.phone.bar', { defaultValue: 'Sections' })}
          className="border-t border-border bg-background pb-[var(--safe-area-inset-bottom)]"
        >
          <div className={cn('grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1 px-2', sideways ? 'h-12' : 'h-16 py-1')}>
            {BAR_LEFT.map(pressOf)}
            <CompanionTalkButton
              size="round"
              compact={sideways}
              state={talk.press.state}
              error={talk.press.error}
              onToggle={talk.press.toggle}
              name={talk.name}
            />
            {BAR_RIGHT.map(pressOf)}
          </div>
        </nav>
      </div>
    </div>
  );
}

type StationPhoneProps = {
  /** The shell's regions, each drawn for the window's tier at compact density (`StationShell`). */
  slots: Partial<Record<StationSlot, ReactNode>>;
  /** The stage, drawn: `StationStage`, which the Stage section holds. */
  stage: ReactNode;
  /** "CloudCLI" in her menu: the shell's way back, which the shell binds (`backToCloudcli`). */
  onBackToCloudcli: () => void;
};

/** A press the scaffold binds to nothing until its fill. */
const NO_PRESS = () => {};

/**
 * The phone's arrangement on the page, drawn by `StationShell` while the arrangement is `phone`: her head and the strip's line
 * from the shell's regions (the strip's week its own, `useStripWeek`, as compact's), the sections over the same regions and the
 * stage, the section held and the stage's pull on it, the count of what needs him, her pending action's line, the page's one
 * talk press, the label of what stands on the stage, and whether the phone is on its side.
 */
export function StationPhone({ slots, stage, onBackToCloudcli }: StationPhoneProps) {
  // FILL: section — the section held and the stage's pull on it, compact's one hook: `const [section, setSection] = useStationSection()`.
  const [section, setSection] = ['conversation', NO_PRESS] as [StationCompactSection, (next: StationCompactSection) => void];
  // FILL: needsCount — what needs him, `useNeedsCount()`: the rail's items and her pending action, null until the first read lands.
  const needsCount = null as number | null;
  // FILL: pending — her one action waiting for his word, `useCompanion().picture?.pending ?? null`.
  const pending = null as CompanionPendingAction | null;
  // FILL: talk — the page's one press, `useCompanion().talk`, and her name, `picture?.settings.name` or `companion.defaultName`.
  const talk = { press: { state: 'idle', toggle: NO_PRESS, error: null }, name: 'Kaylee' } as { press: TalkPress; name: string };
  // FILL: sideways — the phone on its side, `useStation().sideways` (a touch window under 500 px tall).
  const sideways = false as boolean;
  // FILL: focusLabel — the label of what stands on the stage, `useStation().focus?.label ?? null`.
  const focusLabel = null as string | null;
  // FILL: cornerScroll — the corner's place in the station's memory, `useStation().scrollMemory('corner')`: on a phone the corner
  // opens at the narrow tier, where it draws no scroller of its own, so the section's held one is the place it remembers.
  const cornerScroll = undefined as ((node: HTMLElement | null) => void) | undefined;
  // The strip's line and, while he holds it open, its whole week over the middle (compact's own, `useStripWeek`).
  const { line, week } = useStripWeek(slots.strip);

  return (
    <StationPhoneView
      head={slots.head}
      strip={line}
      openStrip={week}
      middle={(
        <StationSectionsView
          section={section}
          slots={{ ...slots, stage }}
          density="compact"
          scrollRefs={cornerScroll === undefined ? undefined : { corner: cornerScroll }}
        />
      )}
      // Keyed by the action, as the card is, so a new action's line starts its own lapse.
      pendingLine={pending === null ? null : <CompanionActionLine key={pending.id} pending={pending} onOpen={() => setSection('needs')} />}
      section={section}
      onSection={setSection}
      needsCount={needsCount}
      focusLabel={focusLabel}
      talk={talk}
      sideways={sideways}
      onBackToCloudcli={onBackToCloudcli}
    />
  );
}
