import { EyeOff, MoreHorizontal } from 'lucide-react';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionMenu, Button, CardFoldToggle, Tooltip } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';

type LaneCardHeadProps = {
  /** Which card this is: the plan's mono name, or the arc's `<name>.arc` door. */
  title: ReactNode;
  /** The card's one status word, in its tone. */
  badge: ReactNode;
  /** The card's one clock — elapsed, ended, or the armed hour — or nothing when no clock ticks. */
  clock?: ReactNode;
  /** How far the card has got: phases done for a plan, plans complete for an arc. `null`, or a total of 0, draws no count. */
  progress: { done: number; total: number } | null;
  /** The second row: the goal clamped to two lines, then who is out on the card and what it waits on. */
  lead?: ReactNode;
  /** The third row: the card's total, as pills. */
  spend?: ReactNode;
  /** The corner's presses: the overflow menu (drawn only when it has items), Hide, and the fold. */
  corner: { menuLabel: string; menuItems: ActionMenuItem[]; onHide: () => void; hideLabel: string };
  /** The title's heading level: 3 for a card that stands on its own, 4 for a plan inside an arc deck, so heading navigation reads the deck's plans as its members. */
  headingLevel?: 3 | 4;
};

/**
 * The corner's box: 40px under `sm`, where a thumb needs a real target, and 28px from there up — the
 * fold toggle's own rule (`CardFoldToggle`), so the three presses of the corner are one size at every
 * width and read as one group.
 */
const CORNER_BUTTON = 'h-10 w-10 text-muted-foreground sm:h-7 sm:w-7';

/** The two homes a card is drawn in; a Hide's focus heir is looked for in the SAME one. */
const HOME = '[data-runner-panel], [data-runner-widget]';

/** Whether a control can take focus now: attached, painted, and not inside a folded (`inert`) body. */
function canFocus(element: HTMLElement): boolean {
  return element.isConnected && element.getClientRects().length > 0 && element.closest('[inert]') === null;
}

/**
 * Hide, with somewhere for the keyboard to land. The pressed button leaves with its card, and a focused
 * node that unmounts drops focus to `<body>` — a keyboard reader who put one card away was thrown back
 * to the top of the document. So the heir is chosen BEFORE the hide, in the same home: the next Hide
 * in document order, else the previous one, never one inside the card that is leaving (an arc's Hide
 * takes its plans with it). It is focused on the next frame, once the hide store's synchronous write
 * has re-rendered the home; a candidate the render took away (the last plan of a deck takes its deck)
 * is skipped, and with none left the heir is the home's `Hidden · N` trigger — which the first hide
 * is what draws.
 */
function hideKeepingFocus(button: HTMLElement | null, onHide: () => void): void {
  const home = button?.closest<HTMLElement>(HOME) ?? null;
  const leaving = button?.closest('[data-dispatcher-card], [data-dispatch-arc]') ?? null;
  const hides = home ? [...home.querySelectorAll<HTMLElement>('[data-dispatcher-hide]')] : [];
  const at = button ? hides.indexOf(button) : -1;
  const heirs = at === -1 ? [] : [...hides.slice(at + 1), ...hides.slice(0, at).reverse()]
    .filter((element) => !leaving?.contains(element) && canFocus(element));
  onHide();
  if (home === null) return;
  requestAnimationFrame(() => {
    const heir = heirs.find(canFocus) ?? home.querySelector<HTMLElement>('[data-hidden-plans] button');
    heir?.focus();
  });
}

/**
 * A menu action, with somewhere for the keyboard to land. `Hide ended plans · N` empties the menu it
 * sits in, so the whole `ActionMenu` unmounts in the same commit as the press and its own close can
 * only restore focus to a trigger that no longer exists — focus fell to `<body>`. So on the next
 * frame, if the menu is gone, focus goes to this head's own Hide (a menu action never takes its own
 * card), else — the action took the whole card — to the home's first Hide, else its `Hidden · N`
 * trigger. A menu that survives its action restores focus to its trigger itself, and nothing here
 * moves it.
 */
function selectKeepingFocus(
  menu: { current: HTMLElement | null },
  hide: { current: HTMLElement | null },
  onSelect: () => void,
): void {
  const home = menu.current?.closest<HTMLElement>(HOME) ?? null;
  onSelect();
  requestAnimationFrame(() => {
    if (menu.current !== null) return;
    const heir = [hide.current, ...(home ? home.querySelectorAll<HTMLElement>('[data-dispatcher-hide]') : [])]
      .find((element): element is HTMLElement => element !== null && canFocus(element))
      ?? home?.querySelector<HTMLElement>('[data-hidden-plans] button');
    heir?.focus();
  });
}

/**
 * A lane card's HEAD — the part that says WHICH card this is and how it stands, and the one part a fold
 * never takes. The plan card and the arc deck both draw it, so the two read alike at a glance: the same
 * rows in the same order, the same corner in the same place.
 *
 * THREE ROWS AND A CORNER. Row one is the title, the card's word bound to `done/total`, and its clock;
 * row two is the lead (the goal, then the planner badge and the waits); row three is the card's total
 * as pills. The corner holds `⋯` (only when the menu has something in it), Hide, and the fold. It is
 * drawn inside the card's `Collapsible` and OUTSIDE its `CardFoldBody`, so a folded card keeps every
 * row of it: name, word, clock, count, goal, spend and the three presses. What folds is the body —
 * the action bar, the face, the strip.
 *
 * HIDE IS IN THE CORNER, NOT IN THE BAR, because it is not a verb on the plan: the dispatcher is never
 * told. It puts the card in the `Hidden` list (`hiddenPlans.ts`), `Show` brings it back, and so no
 * dialog guards it. Focus does not fall to `<body>` with the card: it lands on the next Hide in the
 * same home (`hideKeepingFocus`), and a menu action that empties the menu hands it to this head's
 * own Hide (`selectKeepingFocus`).
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
 * `data-lane-menu`, `data-dispatcher-hide` and the fold's own `data-card-fold`.
 *
 * Used by `PlanCard` and `DispatchArcDeck`.
 */
export function LaneCardHead({ title, badge, clock, progress, lead, spend, corner, headingLevel = 3 }: LaneCardHeadProps) {
  const { t } = useTranslation();
  const hideRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const menuItems = corner.menuItems.map((item) => ({
    ...item,
    onSelect: () => selectKeepingFocus(menuRef, hideRef, item.onSelect),
  }));
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
          <Tooltip content={corner.hideLabel}>
            {/* `flex`, not the kit's `inline-flex`: the tooltip's wrapper is an inline box, and an
                inline button would sit on its line's baseline and add the strut's descent under it. */}
            <Button
              ref={hideRef}
              type="button"
              variant="ghost"
              size="icon"
              className={`flex ${CORNER_BUTTON}`}
              aria-label={corner.hideLabel}
              onClick={() => hideKeepingFocus(hideRef.current, corner.onHide)}
              data-dispatcher-hide
            >
              <EyeOff aria-hidden="true" />
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
