import { type CSSProperties, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { labelTranslate, planRadialLabels } from '@/modules/app-switcher/utils/radialLabels';
import type { SwitcherAction } from '@/shared/types';
import { OWNS_ESCAPE } from '@/shared/ui/overlayEscape';
import { cn } from '@/shared/utils';

type AppSwitcherRadialProps = {
  /** Whether the radial is up. The shell stays mounted through the close so the close can be drawn. */
  open: boolean;
  /** The acts to draw, in the operator's order; one item each, at the point of the same index. The caller leaves out any act that cannot run. */
  acts: SwitcherAction[];
  /** The item centres in viewport pixels, from `radialLayout` for exactly these acts. */
  points: Array<{ x: number; y: number }>;
  /** The FAB's centre, which the arc is drawn around; null until the kit has measured the FAB, when there are no points either. */
  origin: { x: number; y: number } | null;
  /** Puts the radial away: after an act runs, on Escape, on a press outside. */
  onClose: () => void;
  /** Whether this open came from the keyboard (the FAB pressed with no pointer behind it): the first item then takes focus. */
  openedByKeyboard?: boolean;
};

/** How long each item waits after the one before it when the radial opens, so the arc blooms in order. */
const BLOOM_STAGGER_MS = 35;
/** How long an item takes to fade and grow in, and to shrink and fade out. */
const FADE_MS = 200;
/** How long a press or a hover takes to show: the same 150ms every button in the house answers in. */
const FEEDBACK_MS = 150;
/** The kit's FAB, which the radial fans out from: the press that is its own toggle, and where focus goes back to. There is one. */
const FAB_SELECTOR = '.vv-fab';

/**
 * The disc: the kit's `vv-fab-disc` (the FAB's own size, glyph size and 44px catch, all from `--vv-fab-size`
 * in surfaces.css), with the house's border and lift; the ground and ink come per state below. The transitioned properties are listed in ONE order, and `itemTiming` writes a duration and a
 * delay for each in that order: opacity, scale, transform, background-color, visibility. The entry and the exit
 * are `opacity` and the individual `scale` property; a press is the `transform` (Tailwind's `active:scale-95`)
 * and a hover the background colour — separate properties, so the bloom's stagger can delay the first pair and
 * leave a press and a hover answering at once. `motion-reduce:transition-none` clears the list, so the timing
 * inline below is moot there.
 */
const DISC =
  'vv-fab-disc absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto flex touch-manipulation items-center justify-center rounded-full border ' +
  'transition-[opacity,scale,transform,background-color,visibility] ease-enter motion-reduce:transition-none ' +
  'active:scale-95 [&_svg]:pointer-events-none [&_svg]:shrink-0';

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
 * Used by this module's AppSwitcherFab: the switcher's acts that can run drawn on an arc around the FAB, each a
 * disc the size of the FAB with an icon and a label beside it, so the reader sees what a press will do before
 * making it.
 *
 * READING THE ARC. Chat is the first act and the one the reader most often wants, so it is the one disc
 * with a colour (the accent wash and ink); the others are surface discs. An act that cannot run (Reload,
 * Close and Open in a new tab while no application is up) is not drawn at all: the caller hands in only the
 * acts that can, and lays the arc out for exactly those, so the two acts of an empty workspace sit together
 * beside the FAB and the five of a workspace with an application up spread over the whole arc.
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
 * KEYBOARD AND DISMISSAL. Enter or Space on the FAB opens the radial with the first item focused
 * (`openedByKeyboard`, which the FAB reads off the press); the arrow keys move between the items,
 * wrapping, and Enter and Space are the focused item's own click. Escape, a press
 * outside the arc and the FAB, and focus moving into an application's frame each put it away (the effect
 * below says why each is bound where it is), and Escape gives focus back to the FAB. While open the shell
 * carries `OWNS_ESCAPE`, so a dialog under it stands down and ChatInterface's Escape, which stops a running
 * turn, finds the key already taken (`defaultPrevented`).
 *
 * STACKING. `z-[60]`, the FAB's own level in the shell's stacking context (see the note above `.vv-fab` in
 * surfaces.css), and later in the tree, so it draws over the application layer (40) and the floating
 * chat's panel (45). The layer is `pointer-events-none`, so the FAB and the page beneath stay pressable
 * between the items; only the discs take presses. A press outside closes the radial, and the FAB is
 * outside, so the FAB's own press is what toggles it shut.
 */
export function AppSwitcherRadial(props: AppSwitcherRadialProps) {
  const { t } = useTranslation();
  const { open, acts, points, origin } = props;
  const { onClose, openedByKeyboard = false } = props;
  // The shell, for the arrow keys (they find the items by role, never by per-item refs) and for the outside press.
  const container = useRef<HTMLDivElement>(null);
  // The latest `onClose`, read when a key or a press lands: the FAB hands a new function every render, and a
  // listener bound to one render's would either be stale or be rebound on each render of the FAB.
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  // The three ways the reader puts an open radial away without choosing an item, bound only while it is open.
  // The radial belongs to the opener's own window, like the FAB it fans out from, so this is the global `window`.
  //  - Escape, on a WINDOW CAPTURE listener, which runs before every document listener: `preventDefault()` is
  //    the mark ChatInterface's Escape reads (`defaultPrevented`), so a running turn is left alone, and the
  //    shell carries `OWNS_ESCAPE` while open so a dialog under it stands down too. Focus goes back to the FAB.
  //  - A pointerdown outside the shell and the FAB. The FAB is outside the shell but its press is its own
  //    toggle: closing here as well would put the radial away on the pointerdown and let the click reopen it.
  //  - Focus moving into an application's frame. A frame is a cross-origin document, so a press inside it never
  //    reaches this page as a pointerdown; the window's blur, with a frame now holding focus, is that press.
  useEffect(() => {
    if (!open) return undefined;
    const fabOf = () => document.querySelector<HTMLElement>(FAB_SELECTOR);
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeRef.current();
      fabOf()?.focus();
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (container.current?.contains(target) || fabOf()?.contains(target)) return;
      closeRef.current();
    }
    function handleBlur() {
      if (document.activeElement?.tagName === 'IFRAME') closeRef.current();
    }
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [open]);

  // A keyboard open moves focus into the menu in the commit that opens it, before the browser paints, so the
  // arrow keys work at once; a pointer open leaves focus where the reader put it. A layout effect: the items
  // are in the document and visible by then (`visibility` flips with no delay on open — see `itemTiming`).
  useLayoutEffect(() => {
    if (!open || !openedByKeyboard) return;
    container.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, openedByKeyboard]);

  // Read at the moment of drawing, and only while open: the FAB reads the same two numbers to make `points`,
  // and the labels are kept off the viewport's walls by them. The chip is not drawn under a coarse pointer (the
  // same media query hides it in the class below), so it takes no room in the plan either. Without an origin
  // the FAB is unmeasured and there are no points to hang a label on.
  const viewport = open
    ? { width: window.innerWidth, height: window.innerHeight }
    : { width: 0, height: 0 };
  const keyboardless = open && window.matchMedia('(pointer: coarse)').matches;
  const plan =
    open && origin !== null
      ? planRadialLabels(
          points,
          acts.map((act) => ({ label: act.label, shortcut: keyboardless ? null : act.shortcut })),
          viewport,
          origin,
        )
      : null;
  const sides = plan?.sides ?? [];
  const textClip = plan?.textClip ?? null;

  return (
    <div
      data-app-switcher-radial={open ? 'open' : 'closed'}
      // A closed radial exposes nothing: not a menu, not a name, not a claim on Escape.
      {...(open ? { role: 'menu', 'aria-label': t('applications.radialLabel') } : { 'aria-hidden': true })}
      ref={container}
      // Arrows move between the items and wrap; Enter and Space are the focused item's own click, which the
      // item's handler runs. Tab leaves the menu, so the radial closes rather than stay up with focus gone.
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && event.repeat) {
          // A held Enter would press the focused item again and again, and the first item is the Chat toggle.
          event.preventDefault();
          return;
        }
        if (event.key === 'Tab') {
          onClose();
          return;
        }
        const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
        const backward = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
        if (!forward && !backward) return;
        event.preventDefault();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        if (items.length === 0) return;
        const at = items.indexOf(document.activeElement as HTMLElement);
        // Focus not on an item (it is on the FAB): forward starts at the first, backward at the last.
        const next = at === -1 ? (forward ? 0 : items.length - 1) : (at + (forward ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}
      {...(open ? OWNS_ESCAPE : null)}
      className="pointer-events-none fixed inset-0 z-[60]"
    >
      {acts.map((act, index) => {
        const point = points[index];
        if (!point) return null;
        const Icon = act.icon;
        const primary = act.key === 'chat';
        return (
          <button
            key={act.key}
            type="button"
            role="menuitem"
            // Focus is moved by the menu, never by Tab: one Tab stop for the FAB, arrows inside the radial.
            tabIndex={-1}
            aria-keyshortcuts={act.shortcut === null ? undefined : keyShortcutsOf(act.shortcut)}
            data-act={act.key}
            onClick={(event) => {
              // A radial that is closing still has hit-testable discs until the fade ends (`itemTiming` holds
              // `visibility`), so a second click inside the fade would run Reload or Open in a new tab twice.
              if (!open) return;
              act.run();
              onClose();
              // A keyboard press (no pointer behind the click) gives the FAB its focus back: the item is about to
              // be hidden, and a drawer this act opens returns focus to whatever held it when it opened.
              if (event.detail === 0) document.querySelector<HTMLElement>(FAB_SELECTOR)?.focus();
            }}
            className={cn(
              'group',
              DISC,
              open ? 'visible opacity-100 [scale:1]' : 'invisible opacity-0 [scale:0.5]',
              primary
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-accent-ink shadow-[var(--shadow-hover)] [@media(hover:hover)]:hover:bg-[var(--accent-soft-hover)]'
                : 'border-input bg-card text-foreground shadow-[var(--shadow-hover)] [@media(hover:hover)]:hover:bg-secondary',
            )}
            style={{
              left: point.x,
              top: point.y,
              ...itemTiming(open, index),
            }}
          >
            <Icon aria-hidden="true" />
            <span
              data-radial-label={sides[index] ?? 'right'}
              className={cn(
                'absolute left-1/2 top-1/2 flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-1 text-xs font-medium leading-4',
                'transition-colors duration-200 motion-reduce:transition-none',
                'border-input bg-card text-foreground shadow-[var(--shadow-rest)]',
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
