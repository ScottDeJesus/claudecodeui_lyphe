import { useId } from 'react';

import { RAIL_BUTTON_BASE, RAIL_BUTTON_LIT, RAIL_BUTTON_UNLIT } from '@/shared/constants';
import { usePageAnchor } from '@/shared/context/PageAnchorsContext';
import type { AppTab, RailBadge, WorkspaceView } from '@/shared/types';
import { Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

type RailButtonProps = {
  /** The rail name: the button's whole accessible name, its tooltip, and a plugin disc's letter. */
  label: string;
  /** The view this button opens, stamped as `data-view-id` so the rail can find one button without matching its translated name; absent for Settings. */
  viewId?: AppTab;
  /** The key this button is registered under as a page anchor (`PAGE_ANCHOR`), for a floating guide to point at; absent registers nothing. */
  anchorKey?: string;
  /** The view's glyph, or null for a plugin view, which draws its label's first letter on a disc instead. */
  icon: WorkspaceView['icon'];
  /** The view on screen — the rail's one lit glyph. */
  lit?: boolean;
  /** The view's count while there is one; null or absent draws no badge. */
  badge?: RailBadge | null;
  onPress: () => void;
};

/**
 * One button of the views rail: a 20px glyph at stroke 1.75 in a 40px square (44px below md, the touch floor), lit
 * when its view is the one on screen.
 *
 * Its accessible name is the rail name and nothing more. A badge's figure is drawn aria-hidden and its sentence
 * reaches a reader through `aria-describedby`, so "Cerberus" is what the hand, the palette's "Go to Cerberus" and a
 * screen reader all name, and "2 need you" is said after it. The name rides the kit Tooltip on hover and on keyboard
 * focus; no native `title`, which would stack a second tooltip on the first.
 *
 * THE BADGE rests on the glyph's top-right corner: its right edge level with the button's, its bottom edge 1px inside the
 * glyph's top edge, where the glyphs' strokes have barely begun. A "99+" pill is wider than the 14px of rail beside the
 * glyph, so it can only keep off the glyph by standing above it: it grows leftward along the strip over the glyph as the
 * figure widens, which keeps "99+" inside the rail where the scroll region would clip it. Measured on the live rail at
 * "99+", it hides none of the Inbox's tray and under 1% of Cerberus's radar. It rises 5px above a 40px button (3px above
 * a 44px one), into the foot of the button above: the Inbox's neighbour, the companion's disc, ends 6px above it, so a
 * taller or a higher pill would touch the disc.
 * It is an amber pill with a figure, never a bare dot — colour is never the whole signal — and the warn tone's ink edge
 * keeps the fill, 2.07:1 on the rail's canvas, readable as a mark, with no ring to part it from a glyph it barely
 * touches. The figure's line is pinned at `leading-normal`, which centres its digits in the pill to within half a pixel
 * at the ink; a tighter 14px line rides them above the centre.
 *
 * On a phone the focus ring sits on the button's edge (offset 0): a 44px button at the house ring's 2px offset is 52px
 * of ring in a 48px rail, and the scroll region clips what passes its sides. A focused button stands above its
 * neighbours, so a lit or hovered neighbour's ground never paints over its ring.
 *
 * Drawn by this module's WorkspaceRail, once per view and once for Settings.
 */
export default function RailButton({ label, viewId, anchorKey, icon: Icon, lit = false, badge = null, onPress }: RailButtonProps) {
  const wordsId = useId();
  const anchorRef = usePageAnchor(anchorKey ?? null);
  const figure = badge === null ? null : badge.count > 99 ? '99+' : String(badge.count);

  return (
    <Tooltip position="right" showOnFocus content={label}>
      <button
        ref={anchorRef}
        type="button"
        aria-label={label}
        data-view-id={viewId}
        aria-current={lit ? 'page' : undefined}
        aria-describedby={badge === null ? undefined : wordsId}
        onClick={onPress}
        className={cn(
          RAIL_BUTTON_BASE,
          // The lit view says so to a reader with `aria-current`, above; RAIL_BUTTON_LIT carries it to the eye.
          lit ? RAIL_BUTTON_LIT : RAIL_BUTTON_UNLIT,
        )}
      >
        {Icon ? (
          <Icon className="size-5" strokeWidth={1.75} />
        ) : (
          // A plugin names itself and brings no glyph, and a guessed icon would name it wrong. Unlit, its hover turns the
          // square the disc's own --surface2, so the disc takes the canvas there and stays a disc.
          <span
            aria-hidden="true"
            className={cn(
              'grid size-6 place-items-center rounded-full bg-secondary text-xs font-semibold leading-none',
              !lit && 'group-hover/rail-button:bg-background',
            )}
          >
            {Array.from(label.trim())[0]?.toUpperCase() ?? ''}
          </span>
        )}
        {badge !== null && (
          <>
            <span
              aria-hidden="true"
              data-tone="warn"
              // 25px above the centre: the pill's own 16px, less the 1px it stands inside the glyph's top edge (10px above the centre).
              className="pointer-events-none absolute right-[calc(50%-20px)] top-[calc(50%-25px)] h-4 min-w-4 rounded-full border border-tone-ink bg-tone-dot px-1 text-center text-[10.5px] font-bold tabular-nums leading-normal text-foreground dark:text-background"
            >
              {figure}
            </span>
            <span id={wordsId} className="sr-only">
              {badge.words}
            </span>
          </>
        )}
      </button>
    </Tooltip>
  );
}
