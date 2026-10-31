import { cloneElement, isValidElement } from 'react';
import type { ReactNode } from 'react';

import { STATION_OUT_OF_REACH as SECTION_AWAY } from '@/shared/constants';
import type { StationCompactSection, StationDensity } from '@/shared/types';
import { ScrollArea } from '@/shared/ui';
import { cn, isDrawn } from '@/shared/utils';

/** The places the sections draw: the regions of the one-column station's body, and the stage. */
type SectionPlace = 'conversation' | 'dock' | 'talk' | 'needs' | 'sessions' | 'corner' | 'stage';

/**
 * How a place stands in its section's column. `box` sizes it. `held`: the section scrolls the region when the region does not
 * scroll itself (the memory corner opened at the narrow tier is its own height), so the section never runs past the body; a region
 * that scrolls itself fills the box exactly and the box never moves.
 */
type Piece = { place: SectionPlace; box: string; held?: boolean };

/**
 * THE DOCK'S HEAD LINE ALONE, while the keyboard's mark is up and her box (the talk control's field, never the dock's) holds
 * the focus: the dock's padding and its card's frame step aside (the card's own floor, written on its style, let go with them),
 * and so does everything in the card but its head line's row and a refused send's sentence: the field, its notice and Send
 * steer's words. What stands is the one row, its presses at their 44 px. With no draft the dock's quiet line steps aside whole:
 * it gives him nothing to act on while he types to her. Each class spelled whole, so Tailwind finds it.
 */
const DOCK_HEAD_LINE_ALONE = cn(
  '[html[data-keyboard=up]_&]:group-has-[[data-station-slot=talk]_textarea:focus]/section:has-[[data-station-dock=empty]]:hidden',
  '[html[data-keyboard=up]_&]:group-has-[[data-station-slot=talk]_textarea:focus]/section:[&_[data-station-dock]]:py-0',
  '[html[data-keyboard=up]_&]:group-has-[[data-station-slot=talk]_textarea:focus]/section:[&_[data-companion-draft]]:border-0',
  '[html[data-keyboard=up]_&]:group-has-[[data-station-slot=talk]_textarea:focus]/section:[&_[data-companion-draft]]:bg-transparent',
  '[html[data-keyboard=up]_&]:group-has-[[data-station-slot=talk]_textarea:focus]/section:[&_[data-companion-draft]]:p-0',
  '[html[data-keyboard=up]_&]:group-has-[[data-station-slot=talk]_textarea:focus]/section:[&_[data-companion-draft]]:shadow-none',
  '[html[data-keyboard=up]_&]:group-has-[[data-station-slot=talk]_textarea:focus]/section:[&_[data-companion-draft]]:!min-h-0',
  '[html[data-keyboard=up]_&]:group-has-[[data-station-slot=talk]_textarea:focus]/section:[&_[data-companion-draft]>:not([data-companion-draft-head]):not([role=alert])]:hidden',
);

/**
 * THE DOCK'S FIELD UNDER A FINGER, in the sections alone, where the dock scrolls itself (in her column its field gives way to
 * nothing and steps aside whole below its first line): its box, which holds the field alone, keeps the field's 44 px catch, the
 * touch law's press, with the field's top margin and the box's foot (8 + 44 + 4 px), which the card's floor then counts, so the
 * dock scrolls the field rather than shrink it to a sliver. The field's own floor matches the card's two classes and wins on its
 * element.
 */
const FIELD_UNDER_A_FINGER = cn(
  'finger:[&_[data-companion-draft-field]]:min-h-14',
  'finger:[&_[data-companion-draft-field]_textarea]:min-h-11',
);

/**
 * THE ROOM HER LINES TAKE BACK while he types to her with the keys up, beside the dock's head line alone: her log's bottom padding
 * (its newest line stands on the scroller's foot), and her box's own padding over it and all but 4 px under it (the keys stand
 * right there). Measured on its side at 844×390 under a 190 px keyboard: with the draft's head line her newest line
 * stands whole, and with no draft her conversation has the dock's quiet line's 43 px too.
 */
const LOG_ON_ITS_FOOT = '[html[data-keyboard=up]_&]:group-has-[[data-station-slot=talk]_textarea:focus]/section:[&_[role=log]]:pb-0';
const BOX_ON_THE_KEYS = cn(
  '[html[data-keyboard=up]_&]:group-has-[[data-station-slot=talk]_textarea:focus]/section:[&_[data-companion-composer]]:pt-0',
  '[html[data-keyboard=up]_&]:group-has-[[data-station-slot=talk]_textarea:focus]/section:[&_[data-companion-composer]]:pb-1',
);

/**
 * WHICH REGIONS MAKE EACH SECTION, the one drawing of it (compact's arrangement draws it, and the phone's draws it again):
 * - Conversation: her conversation, taking the room; her draft dock under it, its own height up to 45% of the section (her
 *   column's own cap for it) and scrolling itself, so a long brief never squeezes her log away; the box to type to her at the
 *   foot (the talk control's composer half: its button stands in compact's head, and the phone's round one in its bar). WHILE HER DRAFT'S FIELD HOLDS THE FOCUS AND THE KEYBOARD'S
 *   MARK IS UP (`html[data-keyboard=up]`, which `useVisualViewportKeyboardOffset` sets on iOS by the visual viewport's gap and on
 *   Android by a focused field's shrink of the layout viewport) the cap lifts and the box to type to her gives way, so the card,
 *   its target and its sends stand whole above the keys (the dock's own hold, 60% of the frame over them), her conversation taking
 *   what is left. The mark says there are keys; the focused field says which box they are for, so a press of one of the dock's
 *   buttons, or any mouse window however short, folds nothing. WHILE THE MARK IS UP AND HER BOX HOLDS THE FOCUS (he types to
 *   her, not to the brief) the dock draws its head line alone — the card's one row of the target with Steer's state and the
 *   sends with Clear, and a refused send's sentence under it (`DOCK_HEAD_LINE_ALONE`) — and her conversation takes the rest, so
 *   on a phone on its side, where the keys leave the section about 130 px, her lines stay in view while he types; her log's
 *   bottom padding and her box's own padding give their room to her lines then (`LOG_ON_ITS_FOOT`, `BOX_ON_THE_KEYS`). Her log
 *   fits whatever room it is given here, its panel's 3.5rem floor let go, so it never runs under the dock or her box. Under a
 *   finger the dock's field keeps its 44 px catch here, where the dock scrolls itself (`FIELD_UNDER_A_FINGER`).
 * - Needs you: the rail of what needs him, the whole section.
 * - Where things stand: his sessions and the roadmap, taking the room; her memory corner at the foot, closed until he opens
 *   it, and open never more than half the section, so his sessions keep the rest.
 * - Stage: the stage, the whole section; its body scrolls inside it, under its head.
 *
 * The keyboard rules read the mark alone, never the column's room: the arrangement that draws the sections keeps its own room rule
 * on top where it has one (compact's fold of the strip and the switch).
 */
const SECTIONS: Record<StationCompactSection, readonly Piece[]> = {
  conversation: [
    { place: 'conversation', box: cn('min-h-0 flex-1 [&_[data-companion-log]]:min-h-0', LOG_ON_ITS_FOOT) },
    { place: 'dock', box: cn('max-h-[45%] min-h-0 flex-[0_1_auto] [html[data-keyboard=up]_&]:has-[textarea:focus]:max-h-none', DOCK_HEAD_LINE_ALONE, FIELD_UNDER_A_FINGER) },
    { place: 'talk', box: cn('shrink-0 [html[data-keyboard=up]_&]:group-has-[[data-station-slot=dock]_textarea:focus]/section:hidden', BOX_ON_THE_KEYS) },
  ],
  needs: [{ place: 'needs', box: 'min-h-0 flex-1', held: true }],
  where: [
    { place: 'sessions', box: 'min-h-0 flex-1' },
    { place: 'corner', box: 'mt-auto max-h-[50%] min-h-0 flex-[0_1_auto]', held: true },
  ],
  stage: [{ place: 'stage', box: 'min-h-0 flex-1' }],
};

/** The sections in the switch's order, each drawn whether shown or not (see the view). */
const SECTION_ORDER: readonly StationCompactSection[] = ['conversation', 'needs', 'where', 'stage'];


/** What the sections ask of a region drawn in them: their density, and of the talk control its composer half. */
type RegionLook = { density: StationDensity; part?: 'composer' };

/**
 * A region as the sections draw it: handed their density, and the talk control its composer half, so whoever drew the slot
 * (the shell's registry on the page, a fixture's view in the shots) the sections draw the same thing. The stage is drawn as
 * it was handed.
 */
function atLook(node: ReactNode, place: SectionPlace, density: StationDensity): ReactNode {
  if (place === 'stage' || !isValidElement<RegionLook>(node)) return node;
  return cloneElement(node, place === 'talk' ? { density, part: 'composer' } : { density });
}

type StationSectionsViewProps = {
  /** The section shown. */
  section: StationCompactSection;
  /**
   * What each place holds: a region as the shell drew it (`STATION_REGIONS` on the page, a fixture's view in the shots), and the
   * stage, drawn. A place left out draws nothing. EACH REGION'S OWN ELEMENT, NEVER A WRAPPER (no boundary, no provider around
   * it): the sections set its `density` and the talk control's `part` on that element, and a wrapper would take the two props
   * instead, drawing the talk control's button a second time under her head's.
   */
  slots: Partial<Record<SectionPlace, ReactNode>>;
  /** The density every region here is drawn at: `compact` in compact's arrangement and the phone's. */
  density: StationDensity;
  /**
   * The scroller of a `held` place, for the station's scroll memory on the page: bound only where the region draws no scroller of
   * its own (the memory corner at the narrow tier), so a place has one binder. Absent on a fixture, which remembers nothing.
   */
  scrollRefs?: Partial<Record<SectionPlace, (node: HTMLElement | null) => void>>;
};

/**
 * THE ONE-COLUMN STATION'S BODY: the section he chose, full height, its regions as `SECTIONS` stands them, each scrolling
 * inside itself so the page never does.
 *
 * EVERY SECTION STAYS DRAWN, the one shown over the others, which are hidden and inert (out of the tab order and the reading
 * order). So a switch away and back loses nothing: his place in each scroller, the words half typed to her, a fold he opened
 * on the stage. Each region's scroller is still the station's scroll memory under its own key, which carries the places
 * across a reload.
 *
 * Hairlines part the pieces of a section; the regions paint themselves. A place with nothing in it draws nothing, and a
 * section's pieces close up around it.
 *
 * `data-station-sections` reads the section shown, and each piece carries the shell's own `data-station-slot` (the stage's
 * cell `data-station-stage-cell`), so a probe finds a region here as it finds it in the columns. A pure view: drawn by
 * `StationCompactView` (this module) in compact's body and by `StationPhoneView` in the phone's middle, and by
 * `.verify/kaylee-station-shots.mjs` on the fixtures' pictures.
 */
export function StationSectionsView({ section, slots, density, scrollRefs }: StationSectionsViewProps) {
  return (
    <div data-station-sections={section} className="relative min-h-0 flex-1">
      {SECTION_ORDER.map((name) => {
        const shown = name === section;
        const pieces = SECTIONS[name].filter((piece) => isDrawn(slots[piece.place]));
        return (
          <div
            key={name}
            data-station-section={name}
            {...(shown ? null : SECTION_AWAY)}
            className={cn('group/section absolute inset-0 flex min-w-0 flex-col', !shown && 'invisible')}
          >
            {pieces.map((piece, at) => {
              const region = atLook(slots[piece.place], piece.place, density);
              const hairline = at > 0 && 'border-t border-border';
              const handle = {
                'data-station-slot': piece.place === 'stage' ? undefined : piece.place,
                'data-station-stage-cell': piece.place === 'stage' ? '' : undefined,
              };
              // A held region's box is a scroller whose column is the box's height: a region that fills it scrolls itself, and
              // one of its own height runs on inside it.
              return piece.held ? (
                <ScrollArea key={piece.place} {...handle} ref={scrollRefs?.[piece.place]} className={cn(piece.box, hairline)}>
                  <div className="flex h-full min-w-0 flex-col">{region}</div>
                </ScrollArea>
              ) : (
                <div key={piece.place} {...handle} className={cn('flex min-w-0 flex-col', piece.box, hairline)}>
                  {region}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
