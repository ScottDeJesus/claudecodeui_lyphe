import type { ReactNode } from 'react';

import { RAIL_BUTTON_LIT } from '@/shared/constants';
import { CardFoldBody, Collapsible, CollapsibleTrigger, FoldChevron } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * The box every press of the left rail shares, a row and a fold's head alike: the whole row is the press, its text left-set,
 * a 44 px catch under a finger below 768 px (the touch law: `max-md:min-h-11`). Its keyboard ring is drawn INSIDE the row
 * (`-outline-offset-2`), because a row stands flush in a scroller and a fold's body clips what passes its edges: the house's
 * outer ring would be cut in half there.
 */
const PRESS = 'relative flex w-full min-w-0 gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-quick focus-visible:-outline-offset-2 max-md:min-h-11';

/** A row at rest: full ink, and the quiet ground the roadmap's own panel rows take under the pointer. */
const UNLIT = 'text-foreground hover:bg-muted/60';

/**
 * A lit row: the house's lit look (`RAIL_BUTTON_LIT`) with its bar drawn INSIDE the row's left edge. The look stands its bar
 * just outside a rail button; a row in a fold stands flush in the fold's clipping body, which would cut a bar outside it, and
 * the bar is what says "on the stage" without colour (and the only lit sign under forced colours). `cn` is tailwind-merge, so
 * these two insets replace the look's own.
 */
const LIT = cn(RAIL_BUTTON_LIT, 'before:left-0 md:before:left-0');

/**
 * A section's eyebrow: small capitals in the muted ink, the stage's own eyebrow, so the rail and the stage name what they hold
 * alike. An `h2` where the eyebrow is the section's name ("Sessions"); a `p` over a heading of its own ("Roadmap" over the
 * roadmap's title). Used by this module's `SessionRows` and `RoadmapRows`.
 */
export function RailEyebrow({ as: Element, id, children }: { as: 'h2' | 'p'; id?: string; children: ReactNode }) {
  return (
    <Element id={id} className="px-2.5 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </Element>
  );
}

type RailRowProps = {
  /** Which of the rail's rows this is, as `data-station-row` reads it: a session's, an epic's or a feature's. */
  kind: 'session' | 'epic' | 'feature';
  /** The thing's own name (a session id, an epic's or a feature's name), as `data-station-name` reads it. */
  name: string;
  /** Whether the row's thing stands on the stage now. */
  current: boolean;
  /** The press: the row's thing put on the stage. */
  onPress: () => void;
  children: ReactNode;
};

/**
 * ONE ROW OF THE LEFT RAIL, a real `<button>`: a session, an epic or a feature, pressed to put it on the stage.
 *
 * WHILE ITS THING IS ON THE STAGE the row is lit, in the look a lit door, seat and view of the house already wear
 * (`RAIL_BUTTON_LIT`): the soft green ground, the green ink of its name, and the 2 px bar inside its left edge (`LIT`), so the
 * lit row is never colour alone (MAN-578), in a fold as in the open list; a reader hears it as `aria-current="true"`. Only one
 * thing stands on the stage, so at most one row of the rail is lit.
 *
 * Used by this module's `SessionRows` (a session's row) and `RoadmapRows` (an epic's row and a feature's).
 */
export function RailRow({ kind, name, current, onPress, children }: RailRowProps) {
  return (
    <button
      type="button"
      data-station-row={kind}
      data-station-name={name}
      aria-current={current ? 'true' : undefined}
      onClick={onPress}
      className={cn(PRESS, 'items-start', current ? LIT : UNLIT)}
    >
      {children}
    </button>
  );
}

type RailFoldProps = {
  /** Which fold this is, as `data-station-fold` reads it: his asleep chats, or the roadmap's complete epics. */
  kind: 'asleep' | 'complete';
  /** The head's words, its count in them: "Asleep · 11", "Complete · 13". */
  label: string;
  open: boolean;
  /** His press on the head: the fold opened or closed. The rail remembers it per device. */
  onOpenChange: (open: boolean) => void;
  /** What stands under the head's words while the fold is closed, when a row it hides has something to say (her mark). */
  closedMark?: ReactNode;
  /** Whether the thing on the stage is a row of this fold: while the fold is closed that row is out of reach, so the head is lit in its place. */
  current?: boolean;
  /** The rows it holds: drawn, and out of the tab order and the reading order while it is closed. */
  children: ReactNode;
};

/**
 * A FOLD OF THE LEFT RAIL: the kit's `Collapsible`, its head a press as tall as a row (a 44 px catch under a finger), turning
 * the house's one fold sign (`FoldChevron`) beside its words, and its body the kit's `CardFoldBody`, so the rows a closed fold
 * hides are neither tabbed to nor read out. Opened and closed only by his press; the open state is the caller's, which the
 * station keeps per device. While it is closed and the thing on the stage is one of its rows (`current`), its head is lit in
 * that row's place.
 *
 * Used by this module's `SessionRows` (his asleep chats) and `RoadmapRows` (the complete epics).
 */
export function RailFold({ kind, label, open, onOpenChange, closedMark, current = false, children }: RailFoldProps) {
  // The lit row of a closed fold is inert and out of the reading order, so the head stands lit for it (the same look and
  // `aria-current` a row wears): the rail still says which side of it holds what is on the stage. An open fold lights the row itself.
  const litForHiddenRow = current && !open;
  return (
    <Collapsible data-station-fold={kind} open={open} onOpenChange={onOpenChange} className="flex min-w-0 flex-col">
      <CollapsibleTrigger
        data-station-fold-head={kind}
        aria-current={litForHiddenRow ? 'true' : undefined}
        className={cn(PRESS, 'flex-col items-start justify-center gap-1', litForHiddenRow ? LIT : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <FoldChevron collapsed={!open} className="text-sm" />
          <span className="text-sm font-medium">{label}</span>
        </span>
        {/* A line of its own, under the words and clear of the sign, so what it names is never the part a narrow rail cuts. */}
        {!open && closedMark !== undefined && <span className="flex w-full min-w-0 pl-6">{closedMark}</span>}
      </CollapsibleTrigger>
      <CardFoldBody>{children}</CardFoldBody>
    </Collapsible>
  );
}
