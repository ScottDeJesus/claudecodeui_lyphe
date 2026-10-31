import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useCompanion } from '@/modules/companion';
import { useStation } from '@/modules/station/context/StationContext';
import { useStationNeeds } from '@/modules/station/context/StationNeedsContext';
import { useStationSection } from '@/modules/station/hooks/useStationSection';
import { useStripWeek } from '@/modules/station/hooks/useStripWeek';
import { StationSectionsView } from '@/modules/station/StationSections';
import { StationTalk } from '@/modules/station/StationTalk';
import { STATION_OUT_OF_REACH as UNDER_THE_WEEK } from '@/shared/constants';
import type { StationCompactSection, StationSlot, StationTier } from '@/shared/types';
import { Badge, Button, SegmentedControl } from '@/shared/ui';
import { cn, isDrawn } from '@/shared/utils';

/**
 * Her head's row: her head, the talk button and the count of what needs him on one line from 640 px; below, her head and the
 * count on the first line and the talk button across the second, so the button keeps its words whole on a phone.
 */
const HEAD_ROW = cn(
  'grid shrink-0 items-center border-b border-border',
  "grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)_auto] [grid-template-areas:'head_talk_needs']",
  "max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:[grid-template-areas:'head_needs'_'talk_talk']",
);

/**
 * The column's measure: the whole window up to 48rem (a phone, a narrow window), and from there that measure centred under the
 * bar with its edges drawn, so a portrait monitor or a wide window with the switch on reads her lines at a reading length.
 *
 * Its edges are an arbitrary `@media` variant, never a rem `min-[…]`: the project's screens are px, and one `min-[…]` in another
 * unit makes Tailwind refuse every arbitrary `min-[…]`/`max-[…]` sorted after it (the Kanban strip's 900 px rules went with it).
 *
 * It is the size container `station-column` (its height the frame's less the bar, sized by nothing it holds), so what folds while
 * he types reads the room the keys leave it.
 */
const COLUMN = cn(
  'group/compact mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col [container-name:station-column] [container-type:size]',
  '[@media(min-width:50rem)]:border-x [@media(min-width:50rem)]:border-border',
);

/**
 * WHILE THE KEYS TAKE HIS ROOM: on a touch screen, while a field in the body holds the focus (her box, her draft, an answer on
 * the stage) and the column stands under 36rem tall (a phone with its keyboard up: the frame's foot rides the keys, so the
 * column is 447 px at 390×844 with an iPhone's keys and 783 without), the strip's line and the switch fold away, and below
 * 640 px, where it has a row of its own, the talk row too: his field takes their room above the keys, her face and state stay.
 * With a mouse nothing folds, however short the window (a tiled second monitor, a laptop's 600 px): there are no keys to make
 * room for. Nor on a phone before its keys rise. Nothing moves under his eye.
 */
const FOLDS_FOR_THE_KEYS = '[@media(pointer:coarse)]:[@container_station-column_(max-height:36rem)]:group-has-[[data-station-sections]_textarea:focus]/compact:hidden';

/** The talk row's fold: the same, below 640 px only, where it has a row of its own (on one row with her head it would leave a hole). */
const TALK_FOLDS_FOR_THE_KEYS = 'max-sm:[@media(pointer:coarse)]:[@container_station-column_(max-height:36rem)]:group-has-[[data-station-sections]_textarea:focus]/compact:hidden';


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
};

/**
 * THE COMPACT ARRANGEMENT, the station in one column (a second monitor, a small window, and a phone until the phone's own
 * arrangement lands), under the shell's bar. Top to bottom:
 *
 * - HER HEAD, which never scrolls away: her face, her name and her state in words, her controls behind one press (the head
 *   region's compact form); the talk button, the page's one press, its words kept; and the count of what needs him, a press to
 *   Needs you. Her face is never covered: the stage is a section of the body under her head, never an overlay on her.
 * - THE STRIP as one line, "<n> new" and the newest landing. Its press opens the whole week OVER the body: laid from the
 *   line's own top over the line and the switch, both whole and inert under it (no press is ever half covered), and on over the
 *   body as far as it runs, so nothing under it moves; the week's fold, or a landing he puts on the stage, shuts it.
 * - ONE SWITCH between the sections: Conversation, Needs you with its count, Where things stand, and Stage with the label of
 *   what stands there, offered only while something does. A kit `SegmentedControl` from 480 px (the four need about 440), the
 *   Stage's label the one thing that gives way (the kit's `detail`). Below, on a phone, the same sections as kit `Button`s two
 *   to a row, the one shown filled and `aria-current`, so every section stays in sight with its words whole.
 * - THE BODY: the section, full height, each scrolling inside itself (`StationSectionsView`).
 *
 * WHILE THE KEYS TAKE HIS ROOM (on a touch screen, a field in the body focused and the column under 36rem tall: a phone's
 * keyboard up): the strip's line, the switch and, below 640 px, the talk row fold away, so the field and her last lines stand
 * above the keys (`FOLDS_FOR_THE_KEYS`; the sections lift her draft's cap the same way). With a mouse, nothing folds.
 *
 * THE COLUMN is the window's width up to 48rem, and from there that measure centred under the bar with its edges drawn: on a
 * portrait monitor, or a wide window with the switch on, her lines keep a reading length.
 *
 * THE TOUCH LAW. Below 768 px every press here is a 44 px catch: the switch's segments (the kit's own rule there), the
 * sections' buttons below 480 px, the count, and the regions' own presses. Nothing is said only on hover: the count's words
 * are its name.
 * Everything stands inside the shell's frame (status bar, home indicator, keyboard cleared): the week over the body is the
 * one box laid over anything, and it stands inside the arrangement.
 *
 * `data-station-compact` reads the section shown. A pure view: `StationCompact` below binds it, and
 * `.verify/kaylee-station-shots.mjs` draws it on the fixtures' pictures, a section per picture.
 */
export function StationCompactView({ head, talk, strip, openStrip, sections, section, onSection, needsCount, focusLabel }: StationCompactViewProps) {
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
      <div data-station-compact-head="" className={HEAD_ROW}>
        <div data-station-slot="head" className="min-w-0 [grid-area:head]">{head}</div>
        {isDrawn(talk) && (
          <div data-station-slot="talk" className={cn('min-w-0 px-3 py-2 [grid-area:talk] max-sm:pt-0', TALK_FOLDS_FOR_THE_KEYS)}>{talk}</div>
        )}
        <div className="pr-3 [grid-area:needs]">
          <Button
            variant="outline"
            size="sm"
            data-station-compact-needs={needsCount ?? 'unread'}
            aria-label={needsName}
            className="max-md:h-11 max-md:min-w-11"
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
          {/* One breakpoint for the two: the segments from 480 px, the buttons below it, so exactly one switch stands at every width. */}
          <div data-station-compact-sections="" className="hidden min-w-0 [@media(min-width:480px)]:flex">
            <SegmentedControl
              options={offered.map((name) => ({ value: name, label: words[name], count: countOf(name), detail: detailOf(name) }))}
              value={section}
              onChange={onSection}
              label={switchLabel}
            />
          </div>
          <div data-station-compact-grid="" role="group" aria-label={switchLabel} className="grid min-w-0 flex-1 grid-cols-2 gap-1.5 [@media(min-width:480px)]:hidden">
            {offered.map((name) => {
              const shown = name === section;
              const count = countOf(name);
              const detail = detailOf(name);
              return (
                <Button
                  key={name}
                  variant={shown ? 'tonal' : 'outline'}
                  size="sm"
                  aria-current={shown ? 'true' : undefined}
                  className="min-w-0 justify-start max-md:h-11"
                  onClick={() => onSection(name)}
                >
                  {/* The word holds; a count keeps its width; the Stage's label gives way. */}
                  <span className="shrink-0">{words[name]}</span>
                  {count !== undefined && <Badge as="span" tone="neutral" className="shrink-0 tabular-nums">{count}</Badge>}
                  {detail !== undefined && <span className={cn('min-w-0 truncate font-normal', !shown && 'text-muted-foreground')}>{detail}</span>}
                </Button>
              );
            })}
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
  const { needs } = useStationNeeds();
  const { picture } = useCompanion();
  const { focus, scrollMemory } = useStation();
  // What needs him: the rail's items and her one pending action, the two things "What needs you" draws. Null until the first read of the
  // items has landed (`needs` null, in flight or failed): the rail says so in its own words, and a 0 here would claim "nothing waits".
  const needsCount = needs === null ? null : needs.length + (picture?.pending ? 1 : 0);
  const focusLabel = focus === null ? null : focus.label;
  // The strip's line and, while he holds it open, its whole week over the body: the line inert under it (`useStripWeek`).
  const { line, week } = useStripWeek(slots.strip);

  return (
    <StationCompactView
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
