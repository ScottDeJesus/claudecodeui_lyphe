import { Focus, Inbox, LayoutList, MessageCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cloneElement, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionActionLine, CompanionTalkButton, useCompanion } from '@/modules/companion';
import { useStation } from '@/modules/station/context/StationContext';
import { useNeedsCount } from '@/modules/station/context/StationNeedsContext';
import { useOpenPendingCard } from '@/modules/station/hooks/useOpenPendingCard';
import { useStationSection } from '@/modules/station/hooks/useStationSection';
import { useStripWeek } from '@/modules/station/hooks/useStripWeek';
import { StationSectionsView } from '@/modules/station/StationSections';
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
 * WHILE THE KEYBOARD IS UP (`data-keyboard="up"` on html): the frame ends at the keys and the strip's line, the pending line, the
 * talk error and the bar step aside, so the box to type to her sits on the keyboard as a phone's own messaging does, her face and
 * state standing over it. EXCEPT WHILE THE MICROPHONE IS OPEN (the press is `listening`): the foot stays, so the round control that
 * ends the recording is never hidden under the keys (the box to type to her has no talk button of its own), and under the keys it
 * drops the home indicator's padding, which the keyboard covers. The arrangement's root is the size container `station-column`,
 * compact's name for its own column, so the sections fold for the keys here as they do there.
 *
 * ON ITS SIDE (`sideways`): the top row 40 px with her face at 32 px and the strip's line folded into its end as its count, before
 * the count of what needs him: the strip's own count form (`countOnly`, "<n> new" or "Nothing new" and its fold), the newest
 * landing in the week the fold opens over the middle's top, where the count form stands hidden and inert, so nothing stands twice;
 * the bar 48 px with the talk control at its 52 px step, rising over the bar's edge and never into the home indicator's inset;
 * the middle takes the rest.
 *
 * THE TOP ROW STANDS OVER EVERYTHING THE ARRANGEMENT LAYS DOWN (`z-20`, over the week's `z-10`): it is a stacking context, so her
 * menu's panel ranks only inside it, and at the row's old `z-[1]` the opened week covered the panel's first line, Stop's line while
 * she runs, and took the tap aimed at it.
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

  // The count as the glyph alone with its number on the corner, as the bar's Needs you carries it: the row's room is her state's.
  // A read's "0" stands in the quiet tone; before the first read, no number at all.
  const count = (
    <Button
      variant="ghost"
      size="icon"
      data-station-phone-needs={needsCount ?? 'unread'}
      aria-label={needsName}
      className={cn('shrink-0 text-foreground [&_svg]:size-5', sideways ? cn(STATION_SIDEWAYS_CATCH, 'w-11') : 'size-11')}
      onClick={() => onSection('needs')}
    >
      <span className="relative flex">
        <Inbox aria-hidden="true" />
        {needsCount !== null && (
          <Badge as="span" tone={waiting !== null ? 'warn' : 'neutral'} className="vv-badge--compact absolute -right-3 -top-2 tabular-nums">
            {needsCount}
          </Badge>
        )}
      </span>
    </Button>
  );
  // On its side the strip's line stands at the top row's end in the strip's own count form (its `countOnly`, handed by the
  // wrapper): "<n> new" or "Nothing new" and its fold, its newest landing in the week the fold opens. Its own width, never
  // squeezed; her state takes what is left, two lines of it at most (`HeadRow`). While the week stands open over the middle the
  // count form is hidden and inert in its place, as the line is under the week upright: the week's own count and fold stand once.
  const sideStrip = sideways && isDrawn(strip) && (
    <div data-station-slot="strip" {...(weekOpen ? UNDER_THE_WEEK : null)} className={cn('ml-2 flex max-w-96 flex-none', weekOpen && 'invisible')}>
      {strip}
    </div>
  );
  const week = weekOpen && (
    <div
      data-station-phone-week=""
      className={cn('absolute inset-x-0 top-0 z-10 flex min-w-0 items-start border-b border-border bg-background px-3 py-1.5 shadow-lift', !sideways && 'min-h-full')}
    >
      {openStrip}
    </div>
  );

  // One section's press in the bar: its glyph over its word (beside it on its side), the shown one filled. Upright the words are
  // the tab bar's 10 px on 12 px lines, two at most, so the longest ("Where things stand", 102 px at 11 px) stands in a 73 px press.
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
          'min-w-0 rounded-xl [&_svg]:size-5',
          sideways ? 'h-11 gap-1.5 px-1 text-xs' : 'h-full flex-col justify-start gap-1 px-0.5 pb-0.5 pt-1.5 text-[10px] leading-3',
          !shown && 'text-muted-foreground',
        )}
        onClick={() => onSection(name)}
      >
        {/* Upright the count stands on the glyph's corner, as a phone's own tab bar carries one; on its side, after the word. */}
        <span className="relative flex shrink-0">
          <Glyph aria-hidden="true" />
          {counted !== null && !sideways && (
            <Badge as="span" tone="warn" className="vv-badge--compact absolute -right-3 -top-2 tabular-nums">{counted}</Badge>
          )}
        </span>
        {/* `overflow-wrap:anywhere` also shrinks the word's minimum width, so one long token (a path, an id) breaks inside the press, clamped at two lines, and never spills over its neighbours. */}
        <span data-station-phone-word="" className={cn('min-w-0', sideways ? 'truncate' : 'line-clamp-2 whitespace-normal text-center [overflow-wrap:anywhere]')}>{word}</span>
        {counted !== null && sideways && <Badge as="span" tone="warn" className="vv-badge--compact shrink-0 tabular-nums">{counted}</Badge>}
      </Button>
    );
  };

  return (
    <div
      data-station-phone={section}
      data-station-phone-form={sideways ? 'sideways' : 'upright'}
      className="flex min-h-0 w-full flex-1 flex-col [container-name:station-column] [container-type:size]"
    >
      <div data-station-phone-top="" className="relative z-20 shrink-0 border-b border-border bg-background">
        <div data-station-slot="head" className="min-w-0">
          {headAs(head, { sideways, onBackToCloudcli, trail: <>{sideStrip}{count}</> })}
        </div>
      </div>

      {!sideways && isDrawn(strip) && (
        <div className="relative shrink-0 [html[data-keyboard=up]_&]:hidden">
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

      <div data-station-phone-foot="" className={cn('shrink-0', talk.press.state !== 'listening' && '[html[data-keyboard=up]_&]:hidden')}>
        {/* On its side the round control rises 4 px over the bar's edge: the line keeps 4 px of ground at its foot for it, so the
            control never cuts the amber line nor takes a tap meant to open the card. */}
        {/* `empty:hidden`: the line draws nothing once its action lapses (the card's own deadline), and its wrapper, holding nothing, goes with it. */}
        {isDrawn(pendingLine) && <div data-station-phone-pending="" className={cn('empty:hidden', sideways && 'pb-1')}>{pendingLine}</div>}
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
        {/* A group, as compact's section buttons are: it holds the page's talk control, which is no navigation. */}
        <div
          role="group"
          data-station-phone-bar=""
          aria-label={t('station.phone.bar', { defaultValue: 'Sections' })}
          className="border-t border-border bg-background pb-[var(--safe-area-inset-bottom)] [html[data-keyboard=up]_&]:pb-0"
        >
          {/* One row the bar's own height, never its tallest press's: the round control rises past a slimmer row on its side. */}
          <div
            className={cn(
              'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] items-center',
              sideways ? 'h-12 gap-1 px-2' : 'h-16 gap-0.5 px-1.5 py-1',
            )}
          >
            {BAR_LEFT.map(pressOf)}
            {/* On its side the 52 px control stands on the 48 px row's foot, rising 4 px over the bar's edge, never into the inset. */}
            <div className={cn('flex justify-center', sideways && 'self-end')}>
              <CompanionTalkButton
                size="round"
                compact={sideways}
                state={talk.press.state}
                error={talk.press.error}
                onToggle={talk.press.toggle}
                name={talk.name}
              />
            </div>
            {BAR_RIGHT.map(pressOf)}
          </div>
        </div>
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

/**
 * The phone's arrangement on the page, drawn by `StationShell` while the arrangement is `phone`: her head and the strip's line
 * from the shell's regions (the strip's week its own, `useStripWeek`, as compact's), the sections over the same regions and the
 * stage, the section held and the stage's pull on it, the count of what needs him, her pending action's line, the page's one
 * talk press, the label of what stands on the stage, and whether the phone is on its side.
 */
export function StationPhone({ slots, stage, onBackToCloudcli }: StationPhoneProps) {
  const { t } = useTranslation();
  // The section held and the stage's pull on it: compact's one hook, so a tap on anything moves him to Stage with Back to return.
  // The bar always draws Stage, so a press on it with nothing there shows the empty stage instead of bouncing off.
  const [section, setSection] = useStationSection({ offersEmptyStage: true });
  const needsCount = useNeedsCount();
  // The pending line's press: Needs you, with the card it points at brought into view (the rail's remembered place may hide it).
  const openPendingCard = useOpenPendingCard(section, setSection);
  const { picture, talk: press } = useCompanion();
  const { focus, tier, sideways, scrollMemory } = useStation();
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });
  // The corner opened at the narrow tier draws no scroller of its own (`MemoryCornerView`'s `rail`), so the section's held one is the
  // place `corner` remembers; at the wider tiers the corner's own list is bound and this one never scrolls.
  const cornerScroll = tier === 'narrow' ? scrollMemory('corner') : undefined;
  // The strip's line (on its side the strip's count form) and, while he holds it open, its whole week over the middle (compact's
  // own, `useStripWeek`).
  const { line, week } = useStripWeek(slots.strip, { countOnly: sideways });

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
      pendingLine={picture?.pending ? <CompanionActionLine key={picture.pending.id} pending={picture.pending} onOpen={openPendingCard} /> : null}
      section={section}
      onSection={setSection}
      needsCount={needsCount}
      focusLabel={focus === null ? null : focus.label}
      talk={{ press, name }}
      sideways={sideways}
      onBackToCloudcli={onBackToCloudcli}
    />
  );
}
