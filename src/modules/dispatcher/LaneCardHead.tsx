import { EyeOff, Layers, MoreHorizontal, Puzzle, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { putAwayKeepingFocus, selectKeepingFocus } from '@/modules/dispatcher/putAwayFocus';
import type { Kind } from '@/shared/types';
import { ActionMenu, Badge, Button, CardFoldToggle, Tooltip } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';
import { cn } from '@/shared/utils';

type LaneCardHeadProps = {
  /** What KIND of card this is — `epic` for an arc deck, `feature` for a plan card. The head draws the kind tag (`KindTag`) in front of the title; no caller draws a mark of its own. */
  kind: Kind;
  /** Which card this is: its mono name, which the kind tag leads. */
  title: ReactNode;
  /** The card's one status word, in its tone. */
  badge: ReactNode;
  /** The card's one clock — elapsed, ended, or the armed hour — or nothing when no clock ticks. */
  clock?: ReactNode;
  /** How far the card has got: phases done for a plan, plans complete for an arc. `null`, or a total of 0, draws no count. */
  progress: { done: number; total: number } | null;
  /** The second row: the card's description (`CardDescription`, folded to one line until pressed), then who is out on the card and what it waits on. */
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
 * What each kind's tag says besides its colour: the glyph that carries it in greyscale (design doctrine
 * §6 — colour is never the whole signal) and its word. `Layers` is a card that holds cards; `Puzzle` is
 * one piece of an epic, and means nothing else on this board.
 */
const KIND_TAG: Record<Kind, { icon: LucideIcon; wordKey: string }> = {
  epic: { icon: Layers, wordKey: 'dispatcher.kind.epic' },
  feature: { icon: Puzzle, wordKey: 'dispatcher.kind.feature' },
};

/**
 * THE KIND TAG — what tells an arc deck from a plan card at a glance, and what says a plan IS a
 * feature (operator, 2026-10-03: "add color coded epic tags and feature tags, a feature should be
 * indicated as such"; the epic half since 2026-09-28: "a special indicator for arcs on arc cards").
 *
 * A KIND, NOT A STATE: the kit's `Badge` through its `kind` axis, so the paint is Verve's `[data-kind]`
 * pair (violet for an epic, blue for a feature — tokens.css) and never one of the five tones. The tone
 * words on a lane card are states and this is identity; sharing a vocabulary would have a plan "being a
 * feature" read as `info` or `positive`. The glyph and the word carry it without colour. No count: the
 * head already binds `done/total` to the card's word.
 *
 * It rides INSIDE the heading, before the name, so heading navigation hears "Epic restorly" or
 * "Feature roadmap--store", and the tag and the name wrap as words do. `data-kind-tag` is the browser
 * harness's handle.
 */
function KindTag({ kind }: { kind: Kind }) {
  const { t } = useTranslation();
  const { icon: Glyph, wordKey } = KIND_TAG[kind];
  return (
    <Badge as="span" kind={kind} className="me-1 gap-1 align-middle" data-kind-tag={kind}>
      <Glyph aria-hidden="true" className="h-3.5 w-3.5" />
      {t(wordKey)}
    </Badge>
  );
}

/**
 * A lane card's description, FOLDED TO ONE LINE until it is pressed (operator, 2026-10-02: "make the
 * descriptions of plan cards collapsible and default them to collapsed"). The line itself is the press
 * — no chevron and no "more"; the ellipsis is what says there is more — and it opens WHOLE, wrapping
 * with no line cut, until a second press folds it back. Whether it is open is this card's own state
 * and is never stored, so every card starts folded. A press on it starts no drag (`isFreePress`).
 *
 * The clamp rides an inner span, never the button: `-webkit-line-clamp` needs `display: -webkit-box`,
 * which a `<button>` box does not take reliably. Opened, the span is a block, so its own box measures
 * what it paints. `className` is a home's measure (the arc deck's `max-w-3xl`). `data-card-description`
 * marks the span, and the button's `aria-expanded` says which way it stands.
 *
 * Used by `PlanCard` and `DispatchArcDeck`, in the head's lead.
 */
export function CardDescription({ text, className }: { text: string; className?: string }) {
  // Whether the reader opened it. Local and unsaved on purpose: folded is where every card starts.
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen((wasOpen) => !wasOpen)}
      className={cn('min-w-0 text-left text-xs leading-snug text-muted-foreground transition-colors hover:text-foreground', className)}
    >
      <span data-card-description className={cn('break-words', open ? 'block' : 'line-clamp-1')}>{text}</span>
    </button>
  );
}

/**
 * A lane card's HEAD — the part that says WHICH card this is and how it stands, and the one part a fold
 * never takes. The plan card and the arc deck both draw it, so the two share one anatomy — the same
 * rows in the same order, the same corner in the same place — and at a glance differ by one thing: the
 * kind tag leading the title, Epic on the arc deck and Feature on the plan card (`KindTag`, drawn here
 * from the `kind` each caller hands in, so the two heads cannot drift).
 *
 * THREE ROWS AND A CORNER. Row one is the kind tag and the title, the card's word bound to `done/total`,
 * and its clock; row two is the lead (the description, then the planner badge and the waits); row three is the
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
 * THE FLOOR IS CONTENT-DRIVEN AND NOT A BREAKPOINT: these heads are drawn in the Roadmap tab's In flight face and
 * in the chat gutter (a 300–480px column, drawn only where the chat region is 1500px or more — never at phone
 * width, never on a 1440px screen), so an `sm:` rule would put one home's card on the other home's branch.
 *
 * THE KIND TAG RIDES INSIDE THAT FLOOR: it is part of the heading, so the floor is the widest unbreakable
 * item — the tag or the name's longest word — and the tag and the name wrap as words do, the name
 * dropping under the tag where the two do not share a line. It never makes the title narrower than
 * a word.
 *
 * Handles: `data-lane-head` (the head), `data-lane-head-row` (row one), `data-kind-tag` (the tag,
 * `epic` or `feature`), `data-lane-progress`, `data-lane-menu`, the corner press's
 * `data-dispatcher-dismiss` or `data-dispatcher-hide`, and the fold's own `data-card-fold`.
 *
 * Used by `PlanCard` and `DispatchArcDeck`.
 */
export function LaneCardHead({ kind, title, badge, clock, progress, lead, spend, corner, headingLevel = 3 }: LaneCardHeadProps) {
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
          <Heading className="min-w-fit flex-1 break-words text-sm font-medium leading-snug"><KindTag kind={kind} />{' '}{title}</Heading>
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
