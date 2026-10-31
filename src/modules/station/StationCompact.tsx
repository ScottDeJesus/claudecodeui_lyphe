import { Inbox } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { useStation } from '@/modules/station/context/StationContext';
import { useNeedsCount } from '@/modules/station/context/StationNeedsContext';
import { useStationHeadFoot } from '@/modules/station/hooks/useStationHeadFoot';
import { useStationSection } from '@/modules/station/hooks/useStationSection';
import { useStripWeek } from '@/modules/station/hooks/useStripWeek';
import { StationSectionsView } from '@/modules/station/StationSections';
import { StationTalk } from '@/modules/station/StationTalk';
import { STATION_OUT_OF_REACH as UNDER_THE_WEEK } from '@/shared/constants';
import type { StationCompactSection, StationSlot, StationTier } from '@/shared/types';
import { Badge, Button, SegmentedControl } from '@/shared/ui';
import { cn, isDrawn } from '@/shared/utils';

/** Her head's row: her head, the talk button and the count of what needs him on one line. */
const HEAD_ROW = cn(
  'grid shrink-0 items-center border-b border-border',
  "grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)_auto] [grid-template-areas:'head_talk_needs']",
);

/**
 * The column's measure: the whole window up to 48rem (a tablet's width, the narrowest window compact draws in), and from there that measure centred under the
 * bar with its edges drawn, so a portrait monitor or a wide window with the switch on reads her lines at a reading length.
 *
 * Its edges are an arbitrary `@media` variant, never a rem `min-[…]`: the project's screens are px, and one `min-[…]` in another
 * unit makes Tailwind refuse every arbitrary `min-[…]`/`max-[…]` sorted after it (the Kanban strip's 900 px rules went with it).
 *
 * It is the size container `station-column` (its height the frame's less the bar, sized by nothing it holds), so what folds while
 * he types reads the room the keys leave it.
 */
const COLUMN = cn(
  'mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col [container-name:station-column] [container-type:size]',
  '[@media(min-width:50rem)]:border-x [@media(min-width:50rem)]:border-border',
);

/**
 * WHILE THE KEYS TAKE HIS ROOM: while the keyboard's mark is up (`html[data-keyboard=up]`, which both platforms set: the visual
 * viewport's gap on iOS, a focused field's shrink of the layout viewport on Android; `useVisualViewportKeyboardOffset`) and the
 * column stands under 36rem tall (a tablet with its keyboard up: the frame's foot rides the keys), the strip's line and the
 * switch fold away: his field takes their room above the keys, her head stays. The mark says there are keys and the column says
 * whether they leave too little room, so the two are asked together.
 * With a mouse nothing folds, however short the window (a tiled second monitor, a laptop's 600 px): there are no keys to make
 * room for. Nor on a tablet before its keys rise. Nothing moves under his eye.
 */
const FOLDS_FOR_THE_KEYS = '[html[data-keyboard=up]_&]:[@container_station-column_(max-height:36rem)]:hidden';


type StationCompactViewProps = {
  /** Her head at compact density: the `head` slot's region (`StationHead`), her face at 64 px and her controls behind one press. */
  head: ReactNode;
  /** The talk button at compact density, its words kept: `StationTalk` at `part: 'button'`. Its box is in the Conversation section. */
  talk: ReactNode;
  /** The strip's line: the `strip` slot's region at compact density, always folded to one line. */
  strip: ReactNode;
  /** The strip's whole week, opened over the body by the line's press: the strip drawn open. Null while shut. */
  openStrip: ReactNode;
  /** The body: `StationSectionsView` at compact density, showing `section`. */
  sections: ReactNode;
  /** The section the body shows. */
  section: StationCompactSection;
  /** A section chosen: by the switch, or by the count of what needs him (Needs you). */
  onSection: (next: StationCompactSection) => void;
  /** How many things need him: the rail's items and her pending action. Null until the first read of them has landed: the count then says nothing, never "0". */
  needsCount: number | null;
  /** The label of what stands on the stage, or null while the stage is empty: the Stage section is offered only while one stands. */
  focusLabel: string | null;
  /** Put on the head row's box, so `useStationHeadFoot` can write where her head ends. Absent on a fixture's picture, which opens no sheet. */
  headRef?: Ref<HTMLDivElement>;
};

/**
 * THE COMPACT ARRANGEMENT, the station in one column (a second monitor, a tablet, a small window; a phone has its own
 * arrangement, which the shell picks first), under the shell's bar. Top to bottom:
 *
 * - HER HEAD, which never scrolls away: her face, her name and her state in words, her controls behind one press (the head
 *   region's compact form); the talk button, the page's one press, its words kept; and the count of what needs him, a press to
 *   Needs you. Her face is never covered: the stage is a section of the body under her head, never an overlay on her.
 * - THE STRIP as one line, "<n> new" and the newest landing. Its press opens the whole week OVER the body: laid from the
 *   line's own top over the line and the switch, both whole and inert under it (no press is ever half covered), and on over the
 *   body as far as it runs, so nothing under it moves; the week's fold, or a landing he puts on the stage, shuts it.
 * - ONE SWITCH between the sections: Conversation, Needs you with its count, Where things stand, and Stage with the label of
 *   what stands there, offered only while something does. A kit `SegmentedControl`, the Stage's label the one thing that gives
 *   way (the kit's `detail`).
 * - THE BODY: the section, full height, each scrolling inside itself (`StationSectionsView`).
 *
 * WHILE THE KEYS TAKE HIS ROOM (the keyboard's mark up and the column under 36rem tall: a tablet's keyboard up): the strip's
 * line and the switch fold away, so the field and her last lines stand above the keys (`FOLDS_FOR_THE_KEYS`; the sections lift
 * her draft's cap on the same mark). With a mouse, nothing folds.
 *
 * THE COLUMN is the window's width up to 48rem, and from there that measure centred under the bar with its edges drawn: on a
 * portrait monitor, or a wide window with the switch on, her lines keep a reading length.
 *
 * THE TOUCH LAW. Under a finger (a tablet) every press here is a 44 px catch: the switch's segments (the kit's own rule
 * there), the count, and the regions' own presses. Nothing is said only on hover: the count's words are its name.
 * Everything stands inside the shell's frame (status bar, home indicator, keyboard cleared): the week over the body is the
 * one box laid over anything, and it stands inside the arrangement.
 *
 * `data-station-compact` reads the section shown. A pure view: `StationCompact` below binds it, and
 * `.verify/kaylee-station-shots.mjs` draws it on the fixtures' pictures, a section per picture.
 */
export function StationCompactView({ head, talk, strip, openStrip, sections, section, onSection, needsCount, focusLabel, headRef }: StationCompactViewProps) {
  const { t } = useTranslation();
  const weekOpen = isDrawn(openStrip);

  const words: Record<StationCompactSection, string> = {
    conversation: t('station.compact.section.conversation', { defaultValue: 'Conversation' }),
    needs: t('station.compact.section.needs', { defaultValue: 'Needs you' }),
    where: t('station.compact.section.where', { defaultValue: 'Where things stand' }),
    stage: t('station.compact.section.stage', { defaultValue: 'Stage' }),
  };
  const offered: StationCompactSection[] = focusLabel === null ? ['conversation', 'needs', 'where'] : ['conversation', 'needs', 'where', 'stage'];
  // What each section carries after its word: what needs him, counted, and what stands on the stage.
  const countOf = (name: StationCompactSection) => (name === 'needs' && needsCount !== null && needsCount > 0 ? needsCount : undefined);
  const detailOf = (name: StationCompactSection) => (name === 'stage' && focusLabel !== null ? focusLabel : undefined);
  const switchLabel = t('station.compact.switchLabel', { defaultValue: 'Section' });
  // Before the first read lands the name claims nothing: "Nothing needs you" is a read's answer, and none has come (or it failed).
  const needsName = needsCount === null
    ? t('station.compact.needsPressUnread', { defaultValue: 'Open Needs you' })
    : t('station.compact.needsPress', { count: needsCount, defaultValue: '{{count}} need you: open Needs you' });

  return (
    <div data-station-compact={section} className={COLUMN}>
      <div ref={headRef} data-station-compact-head="" className={HEAD_ROW}>
        <div data-station-slot="head" className="min-w-0 [grid-area:head]">{head}</div>
        {isDrawn(talk) && (
          <div data-station-slot="talk" className="min-w-0 px-3 py-2 [grid-area:talk]">{talk}</div>
        )}
        <div className="pr-3 [grid-area:needs]">
          <Button
            variant="outline"
            size="sm"
            data-station-compact-needs={needsCount ?? 'unread'}
            aria-label={needsName}
            className="finger:h-11 finger:min-w-11"
            onClick={() => onSection('needs')}
          >
            <Inbox aria-hidden="true" />
            {needsCount === null ? null : needsCount > 0 ? (
              <Badge as="span" tone="warn" className="tabular-nums">{needsCount}</Badge>
            ) : (
              <span className="tabular-nums text-muted-foreground">0</span>
            )}
          </Button>
        </div>
      </div>

      {/* The strip's line and the switch, with the week laid over the two whole while it stands: no press half covered. */}
      <div className={cn('relative shrink-0', FOLDS_FOR_THE_KEYS)}>
        {isDrawn(strip) && (
          <div data-station-compact-strip={weekOpen ? 'open' : 'line'} className="border-b border-border">
            <div data-station-slot="strip" {...(weekOpen ? UNDER_THE_WEEK : null)} className="flex min-w-0 px-3 py-1.5">
              {strip}
            </div>
          </div>
        )}
        <div data-station-compact-switch="" {...(weekOpen ? UNDER_THE_WEEK : null)} className="flex items-center border-b border-border px-3 py-2">
          <div data-station-compact-sections="" className="flex min-w-0">
            <SegmentedControl
              options={offered.map((name) => ({ value: name, label: words[name], count: countOf(name), detail: detailOf(name) }))}
              value={section}
              onChange={onSection}
              label={switchLabel}
            />
          </div>
        </div>
        {weekOpen && (
          <div data-station-compact-week="" className="absolute inset-x-0 top-0 z-10 flex min-h-full min-w-0 items-start border-b border-border bg-background px-3 py-1.5 shadow-lift">
            {openStrip}
          </div>
        )}
      </div>

      {sections}
    </div>
  );
}

type StationCompactProps = {
  /** The shell's regions, each drawn for the window's tier (`StationShell`). */
  slots: Partial<Record<StationSlot, ReactNode>>;
  /** The stage, drawn: `StationStage`, which the Stage section holds. */
  stage: ReactNode;
  /** The window's tier, which the head's talk button is drawn for. */
  tier: StationTier;
};

/**
 * The compact arrangement on the page, drawn by `StationShell` while the arrangement is compact: her head and the strip's line
 * from the shell's regions, the talk control's button half for her head, the sections over the same regions and the stage, the
 * section held and the stage's pull on it, the count of what needs him and the label of what stands on the stage.
 */
export function StationCompact({ slots, stage, tier }: StationCompactProps) {
  const [section, setSection] = useStationSection();
  const { focus, scrollMemory } = useStation();
  // What needs him, one number for compact and the phone (`useNeedsCount`); null until the first read of the items has landed.
  const needsCount = useNeedsCount();
  const focusLabel = focus === null ? null : focus.label;
  // The strip's line and, while he holds it open, its whole week over the body: the line inert under it (`useStripWeek`).
  const { line, week } = useStripWeek(slots.strip);
  // Where her head ends, written for the sheets that must stand below her face (`CheckStage`'s check sheet).
  const headRef = useStationHeadFoot();

  return (
    <StationCompactView
      headRef={headRef}
      head={slots.head}
      talk={<StationTalk tier={tier} density="compact" part="button" />}
      strip={line}
      openStrip={week}
      // The corner opened at the narrow tier draws no scroller of its own (`MemoryCornerView`'s `rail`), so the section's held one is the
      // place `corner` remembers; at the wider tiers the corner's own list is bound and this one never scrolls.
      sections={(
        <StationSectionsView
          section={section}
          slots={{ ...slots, stage }}
          density="compact"
          scrollRefs={tier === 'narrow' ? { corner: scrollMemory('corner') } : undefined}
        />
      )}
      section={section}
      onSection={setSection}
      needsCount={needsCount}
      focusLabel={focusLabel}
    />
  );
}
