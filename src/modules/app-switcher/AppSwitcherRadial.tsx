import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import {
  labelTranslate,
  planRadialLabels,
  RADIAL_DISC_PX,
} from '@/modules/app-switcher/utils/radialLabels';
import type { SwitcherAction } from '@/shared/types';
import { cn } from '@/shared/utils';

type AppSwitcherRadialProps = {
  /** Whether the radial is up. The shell stays mounted through the close so the close can be drawn. */
  open: boolean;
  /** The switcher's five acts, in the operator's order; one item each, at the point of the same index. */
  acts: SwitcherAction[];
  /** The item centres in viewport pixels, from `radialLayout`. */
  points: Array<{ x: number; y: number }>;
  /** Puts the radial away: after an act runs, on Escape, on a press outside. */
  onClose: () => void;
};

/** How long each item waits after the one before it when the radial opens, so the arc blooms in order. */
const BLOOM_STAGGER_MS = 35;
/** How long an item takes to fade and grow in, and to shrink and fade out. */
const FADE_MS = 200;
/** How long a press or a hover takes to show: the same 150ms every button in the house answers in. */
const FEEDBACK_MS = 150;

/**
 * The disc: a target sized by `RADIAL_DISC_PX`, with the house's border and lift; the ground and ink come per
 * state below. The transitioned properties are listed in ONE order, and `itemTiming` writes a duration and a
 * delay for each in that order: opacity, scale, transform, background-color, visibility. The entry and the exit
 * are `opacity` and the individual `scale` property; a press is the `transform` (Tailwind's `active:scale-95`)
 * and a hover the background colour — separate properties, so the bloom's stagger can delay the first pair and
 * leave a press and a hover answering at once. `motion-reduce:transition-none` clears the list, so the timing
 * inline below is moot there.
 */
const DISC =
  'absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto flex touch-manipulation items-center justify-center rounded-full border ' +
  'transition-[opacity,scale,transform,background-color,visibility] ease-enter motion-reduce:transition-none ' +
  'active:scale-95 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0';

/**
 * The timing of one item's transitions, for the order `DISC` lists them in.
 *
 * VISIBILITY IS ON ITS OWN CLOCK, and that is the point of writing the lists out. A single `transition-delay`
 * applies to every property it is listed for, `visibility` included, and a delayed `visibility` transition
 * holds `hidden` through its delay: the first item could not take focus until its stagger had run, and the
 * last not for 163ms. So on OPEN, `visibility` flips at once, with no delay, and only the fade and the growth
 * wait their turn in the arc (an item that is visible and still transparent can hold focus, and ArrowDown can
 * land on it); on CLOSE, `visibility` waits out the fade so the item is not hidden before it has faded. A
 * press and a hover never wait.
 */
function itemTiming(open: boolean, index: number): CSSProperties {
  const bloom = open ? index * BLOOM_STAGGER_MS : 0;
  return {
    transitionDuration: `${FADE_MS}ms, ${FADE_MS}ms, ${FEEDBACK_MS}ms, ${FEEDBACK_MS}ms, 0s`,
    transitionDelay: `${bloom}ms, ${bloom}ms, 0s, 0s, ${open ? 0 : FADE_MS}ms`,
  };
}

/** The key the shortcut answers to, as `aria-keyshortcuts` writes it: the printed `Ctrl+.` or `⌘.`. */
function keyShortcutsOf(shortcut: string): string {
  return shortcut.replace('Ctrl+', 'Control+').replace('⌘', 'Meta+');
}

/**
 * Used by this module's AppSwitcherFab: the switcher's five acts drawn on an arc around the FAB, each a
 * disc with an icon and a label beside it, so the reader sees what a press will do before making it.
 *
 * READING THE ARC. Chat is the first act and the one the reader most often wants, so it is the one disc
 * with a colour (the accent wash and ink); the four beside it are surface discs. An act that cannot run
 * (Reload, Close and Open in a new tab while no application is up) stays where it is, drawn as a dashed
 * ring on the canvas ground with faint ink — opaque, so what it floats over never shows through it: the
 * arc never changes shape under the reader's hand, and the reason a press does nothing is visible before
 * they try it. It keeps `aria-disabled` rather than `disabled`, so a screen
 * reader and the arrow keys still reach it and can hear that it is unavailable.
 *
 * THE LABEL IS A PILL ON THE SURFACE GROUND, not bare text: the radial floats over an application of any
 * colour, and only an opaque ground holds the ink's contrast on all of them. Which side of its disc a
 * label stands on comes from the arc (`planRadialLabels`): outward, in the open space the arc faces, moving
 * to another side where it would meet a disc, the FAB or another label — and, where no side is clear, its word
 * cut short with an ellipsis. The label is inside the disc's button, so a press on
 * either is the item's press and the item's accessible name is its label. The Chat act's shortcut is a
 * `kbd` chip after its label, drawn only where there is a keyboard to press it on (not under a coarse pointer)
 * and hidden from assistive technology: the shortcut is said once, by `aria-keyshortcuts` on the item, and the
 * item's name stays its label.
 *
 * MOTION. The shell is always mounted and only the items change: closed, they are invisible, shrunk and
 * transparent; open, they grow to size in a stagger, and back on close. Every transition is `none` under
 * `prefers-reduced-motion`, so the open there is one frame. The stagger never reaches `visibility` (see
 * `itemTiming`), so an item can take focus in the frame the radial opens. While closed nothing is exposed — no role,
 * no name, no escape claim, and `visibility: hidden` on the items keeps them out of the tab order and
 * off the hit test — because a panel's claim on the Escape key is honest only for as long as it is up.
 *
 * STACKING. `z-[60]`, the FAB's own level in the shell's stacking context (see the note above `.vv-fab` in
 * surfaces.css), and later in the tree, so it draws over the application layer (40) and the floating
 * chat's panel (45). The layer is `pointer-events-none`, so the FAB and the page beneath stay pressable
 * between the items; only the discs take presses. A press outside closes the radial, and the FAB is
 * outside, so the FAB's own press is what toggles it shut.
 */
export function AppSwitcherRadial(props: AppSwitcherRadialProps) {
  const { t } = useTranslation();
  const { open, acts, points } = props;
  // FILL: close — `const { onClose } = props;`; every item, Escape and the outside press put the radial away through it
  // FILL: outside-press

  // Read at the moment of drawing, and only while open: the FAB reads the same two numbers to make `points`,
  // and the labels are kept off the viewport's walls by them. The chip is not drawn under a coarse pointer (the
  // same media query hides it in the class below), so it takes no room in the plan either.
  const viewport = open
    ? { width: window.innerWidth, height: window.innerHeight }
    : { width: 0, height: 0 };
  const keyboardless = open && window.matchMedia('(pointer: coarse)').matches;
  const plan = open
    ? planRadialLabels(
        points,
        acts.map((act) => ({ label: act.label, shortcut: keyboardless ? null : act.shortcut })),
        viewport,
      )
    : null;
  const sides = plan?.sides ?? [];
  const textClip = plan?.textClip ?? null;

  return (
    <div
      data-app-switcher-radial={open ? 'open' : 'closed'}
      // A closed radial exposes nothing: not a menu, not a name, not a claim on Escape.
      {...(open ? { role: 'menu', 'aria-label': t('applications.radialLabel') } : { 'aria-hidden': true })}
      // FILL: keyboard — first item focused on a keyboard open; arrows move; Enter runs
      // FILL: escape — window capture, preventDefault, OWNS_ESCAPE while open
      className="pointer-events-none fixed inset-0 z-[60]"
    >
      {acts.map((act, index) => {
        const point = points[index];
        if (!point) return null;
        const Icon = act.icon;
        const primary = act.key === 'chat' && !act.disabled;
        return (
          <button
            key={act.key}
            type="button"
            role="menuitem"
            // Focus is moved by the menu, never by Tab: one Tab stop for the FAB, arrows inside the radial.
            tabIndex={-1}
            aria-disabled={act.disabled}
            aria-keyshortcuts={act.shortcut === null ? undefined : keyShortcutsOf(act.shortcut)}
            data-act={act.key}
            // A press on a greyed act does nothing and says so with the cursor; it is still a press the
            // handler below receives, so the fill's run must skip an act that `disabled` names.
            onClick={() => { /* FILL: run — act.run() then onClose() */ }}
            className={cn(
              'group',
              DISC,
              open ? 'visible opacity-100 [scale:1]' : 'invisible opacity-0 [scale:0.5]',
              act.disabled
                ? 'cursor-not-allowed border-dashed border-input bg-background text-ink-faint'
                : primary
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-accent-ink shadow-[var(--shadow-hover)] [@media(hover:hover)]:hover:bg-[var(--accent-soft-hover)]'
                  : 'border-input bg-card text-foreground shadow-[var(--shadow-hover)] [@media(hover:hover)]:hover:bg-secondary',
            )}
            style={{
              left: point.x,
              top: point.y,
              width: RADIAL_DISC_PX,
              height: RADIAL_DISC_PX,
              ...itemTiming(open, index),
            }}
          >
            <Icon aria-hidden="true" />
            <span
              data-radial-label={sides[index] ?? 'right'}
              className={cn(
                'absolute left-1/2 top-1/2 flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-1 text-xs font-medium leading-4',
                'transition-colors duration-200 motion-reduce:transition-none',
                act.disabled
                  ? 'border-dashed border-input bg-card text-ink-faint'
                  : 'border-input bg-card text-foreground shadow-[var(--shadow-rest)]',
                !act.disabled &&
                  'group-focus-visible:border-[var(--accent)] group-focus-visible:bg-[var(--accent-soft)] [@media(hover:hover)]:group-hover:border-[var(--accent)]',
              )}
              style={{ transform: labelTranslate(sides[index] ?? 'right', point) }}
            >
              <span className={cn(textClip !== null && 'truncate')} style={textClip === null ? undefined : { maxWidth: textClip }}>
                {act.label}
              </span>
              {act.shortcut !== null && (
                <kbd
                  aria-hidden="true"
                  className="rounded border border-input bg-muted px-1 font-mono text-[11px] leading-4 text-muted-foreground [@media(pointer:coarse)]:hidden"
                >
                  {act.shortcut}
                </kbd>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
