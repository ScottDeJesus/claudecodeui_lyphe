import { EyeOff, MoreHorizontal, X } from 'lucide-react';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { putAwayKeepingFocus, selectKeepingFocus } from '@/modules/dispatcher/putAwayFocus';
import { ActionMenu, Button, CardFoldToggle, Tooltip } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';

type LaneCardHeadProps = {
  /** Which card this is: the plan's mono name, or the arc's mark and mono name (`ArcMark`) — the one thing that tells the two heads apart. */
  title: ReactNode;
  /** The card's one status word, in its tone. */
  badge: ReactNode;
  /** The card's one clock — elapsed, ended, or the armed hour — or nothing when no clock ticks. */
  clock?: ReactNode;
  /** How far the card has got: phases done for a plan, plans complete for an arc. `null`, or a total of 0, draws no count. */
  progress: { done: number; total: number } | null;
  /** The second row: the card's description (`cardDescription`) clamped to two lines, then who is out on the card and what it waits on. */
  lead?: ReactNode;
  /** The third row: the card's total, as pills. */
  spend?: ReactNode;
  /**
   * The corner's presses: the overflow menu (drawn only when it has items), the put-away press, and
   * the fold. `putAway.verb` is `dismiss` on a DONE card and `hide` on an unfinished one
   * (`putAwayVerb`), and `label` is its name and its tooltip.
   */
  corner: {
    menuLabel: string;
    menuItems: ActionMenuItem[];
    putAway: { verb: 'dismiss' | 'hide'; label: string; onPress: () => void };
  };
  /** The title's heading level: 3 for a card that stands on its own, 4 for a plan inside an arc deck, so heading navigation reads the deck's plans as its members. */
  headingLevel?: 3 | 4;
};

/**
 * The corner's box: 40px under `sm`, where a thumb needs a real target, and 28px from there up — the
 * fold toggle's own rule (`CardFoldToggle`), so the three presses of the corner are one size at every
 * width and read as one group.
 */
const CORNER_BUTTON = 'h-10 w-10 text-muted-foreground sm:h-7 sm:w-7';

/**
 * A lane card's HEAD — the part that says WHICH card this is and how it stands, and the one part a fold
 * never takes. The plan card and the arc deck both draw it, so the two share one anatomy — the same
 * rows in the same order, the same corner in the same place — and at a glance differ by one thing: the
 * arc's mark leading its title (`ArcMark`, handed in by `DispatchArcDeck`).
 *
 * THREE ROWS AND A CORNER. Row one is the title, the card's word bound to `done/total`, and its clock;
 * row two is the lead (the description, then the planner badge and the waits); row three is the
 * card's total as pills. The corner holds `⋯` (only when the menu has something in it), Dismiss or
 * Hide, and the fold. It is drawn inside the card's `Collapsible` and OUTSIDE its `CardFoldBody`, so a
 * folded card keeps every row of it: name, word, clock, count, description, spend and the three
 * presses. What folds is the body — the action bar, the face, the strip.
 *
 * DISMISS AND HIDE ARE IN THE CORNER, NOT IN THE BAR, because neither is a verb on the plan: the
 * dispatcher is never told (`hiddenPlans.ts`). A DONE card offers Dismiss (`X`): the card leaves the
 * board, and nothing lists it. An unfinished card offers Hide (`EyeOff`): the card goes to the
 * `Hidden` list and `Show` brings it back. Neither deletes anything, so no dialog guards either. Focus
 * does not fall to `<body>` with the card: it lands on the next corner press in the same home
 * (`putAwayKeepingFocus`), and a menu action that empties the menu hands it to this head's own
 * (`selectKeepingFocus`).
 *
 * THE ROW WRAPS AND THE TITLE HAS A FLOOR, AND BOTH ARE NEEDED — each alone still crushes the name
 * (INV-4449). The badge, the clock, the count and the corner are all things that must not give, so the
 * title is the only item left that CAN: it carries `flex-1`, and `min-w-0` once released it even from
 * its own content, so a 101px arc name in a 332px row beside what was then a 245px spend sentence and a
 * badge collapsed — one letter per line in a zero-width box (measured 12 lines), with the row's last
 * 23px (the fold's own control) spilled past the card's right edge. That is the phone screenshot
 * (2026-09-25, `/tmp/chains/arc-header-phone.jpg`). `min-w-fit` is the floor that ends it: never
 * narrower than its own longest word, so the title reads on one line, or wraps BY WORD — and it is the
 * title's own floor, not a shrink, that then hands the word, the clock and the count a line of their
 * own on a narrow screen. `flex-wrap` is the other half: a floor without a wrap would push them off
 * the card instead of under the title. The corner stands OUTSIDE the wrapping group, `shrink-0`, so the
 * presses keep the row's top-right whatever the group does.
 *
 * THE FLOOR HAS ONE BOUND, MEASURED RATHER THAN ASSUMED: `fit-content` is
 * `min(max-content, max(min-content, available))` — capped by the room the row can give — and
 * `break-words` (`overflow-wrap: break-word`) does NOT lower a word's intrinsic min-content. So a
 * title that is ONE token with no space and no hyphen anywhere in it, wider than the row, neither
 * wraps nor shrinks: the name leaves the card (measured at 390px with a 74-character token — one 622px
 * line in a 332px row, 278px past the deck's right edge, the page itself not scrolling because its
 * ancestors clip it). No name the corpus holds reaches that: its longest unbroken segment is 19
 * characters, and a plan's `--` breaks it further. It is still strictly better than crushing the same
 * token into a 25px column of 37 stacked letters — and the row's own `scrollWidth` against its
 * `clientWidth` is the reading that catches it (`data-lane-head-row`).
 *
 * THE FLOOR IS CONTENT-DRIVEN AND NOT A BREAKPOINT: these heads are drawn in the Runner tab and in the
 * chat gutter (~380px even on a 1440px screen), so an `sm:` rule would put one home's card on the
 * other home's branch.
 *
 * Handles: `data-lane-head` (the head), `data-lane-head-row` (row one), `data-lane-progress`,
 * `data-lane-menu`, the corner press's `data-dispatcher-dismiss` or `data-dispatcher-hide`, and the
 * fold's own `data-card-fold`.
 *
 * Used by `PlanCard` and `DispatchArcDeck`.
 */
export function LaneCardHead({ title, badge, clock, progress, lead, spend, corner, headingLevel = 3 }: LaneCardHeadProps) {
  const { t } = useTranslation();
  const pressRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const menuItems = corner.menuItems.map((item) => ({
    ...item,
    onSelect: () => selectKeepingFocus(menuRef, pressRef, item.onSelect),
  }));
  const { putAway } = corner;
  const PutAwayIcon = putAway.verb === 'dismiss' ? X : EyeOff;
  // One handle per verb, on the button itself, so a probe tells a Dismiss from a Hide without its words.
  const verbHandle = putAway.verb === 'dismiss' ? { 'data-dispatcher-dismiss': '' } : { 'data-dispatcher-hide': '' };
  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  const counted = progress !== null && progress.total > 0 ? progress : null;
  const countWords = counted ? t('dispatcher.flow.caption', counted) : '';

  return (
    <div data-lane-head className="flex min-w-0 flex-col gap-1.5">
      <div data-lane-head-row className="flex min-w-0 items-start gap-2">
        {/* The group's floor is the corner's height (`CORNER_BUTTON`), so a one-line title centres on
            the corner's presses rather than riding their top edge. */}
        <div className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 sm:min-h-7">
          <Heading className="min-w-fit flex-1 break-words text-sm font-medium leading-snug">{title}</Heading>
          {/* THE WORD AND THE COUNT ARE ONE UNBREAKABLE PAIR (`COMPLETE 14/14`): wrapped as two free
              items, the count fell onto a line of its own on half the heads at 320px and read as a
              stray number. The pair is narrower than the narrowest group, so it never overflows;
              the clock stays free to wrap. */}
          <span className="inline-flex flex-none items-center gap-2 whitespace-nowrap">
            {badge}
            {counted && (
              // The count is read as words (`14 of 14 done`) and seen as figures: `14/14` would be
              // read out as "fourteen slash fourteen". It wears the ink the muted clock does not:
              // "how far" is the glance's question, and a grey count ran into a grey clock.
              <span data-lane-progress className="text-xs font-medium tabular-nums text-foreground" title={countWords}>
                <span aria-hidden="true">{counted.done}/{counted.total}</span>
                <span className="sr-only">{countWords}</span>
              </span>
            )}
          </span>
          {clock}
        </div>
        <div data-lane-corner className="flex shrink-0 items-center">
          {menuItems.length > 0 && (
            <span ref={menuRef} data-lane-menu className="flex">
              <ActionMenu
                label={corner.menuLabel}
                items={menuItems}
                icon={MoreHorizontal}
                iconOnly
                variant="ghost"
                size="icon"
                triggerClassName={CORNER_BUTTON}
              />
            </span>
          )}
          <Tooltip content={putAway.label}>
            {/* `flex`, not the kit's `inline-flex`: the tooltip's wrapper is an inline box, and an
                inline button would sit on its line's baseline and add the strut's descent under it. */}
            <Button
              ref={pressRef}
              type="button"
              variant="ghost"
              size="icon"
              className={`flex ${CORNER_BUTTON}`}
              aria-label={putAway.label}
              onClick={() => putAwayKeepingFocus(pressRef.current, putAway.onPress)}
              {...verbHandle}
            >
              <PutAwayIcon aria-hidden="true" />
            </Button>
          </Tooltip>
          <CardFoldToggle />
        </div>
      </div>
      <div data-lane-lead className="flex min-w-0 flex-col gap-1 empty:hidden">{lead}</div>
      <div data-lane-spend className="min-w-0 empty:hidden">{spend}</div>
    </div>
  );
}
