import { useTranslation } from 'react-i18next';
import { ArrowDownRightIcon, ArrowUpRightIcon } from 'lucide-react';

import { Card } from '@/shared/ui';
import { deltaTone } from '@/modules/chat/transcript/shapes/detect';
import type { DeltaTone, StatTile } from '@/modules/chat/transcript/shapes/detect';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';

type StatTilesProps = {
  /** Every line of the fence, already parsed WHOLE by `parseStatsFence` — never a partial row. */
  tiles: StatTile[];
  collapseKey: string;
};

/**
 * The arrow beside a signed delta: the channel a reader in greyscale still gets. A neutral delta
 * has no direction to point, so it carries none rather than a sideways glyph that means nothing.
 */
const DELTA_ARROW: Record<DeltaTone, typeof ArrowUpRightIcon | null> = {
  positive: ArrowUpRightIcon,
  danger: ArrowDownRightIcon,
  neutral: null,
};

/**
 * A `stats` fence as a row of stat tiles: a muted uppercase label, the value large in the display
 * face, and the delta under it toned by its sign.
 *
 * Used by `code/CodeFence.tsx` and nothing else, and only once `parseStatsFence` accepted EVERY
 * line of the fence — one malformed line and the fence stays an ordinary code block, because
 * drawing the tiles that did parse would silently drop the one that did not.
 *
 * It draws from parsed text, and that loses nothing: a fence body has no inline marks to lose, and
 * every cell the author wrote — label, value, delta — is on screen verbatim.
 *
 * Each tile is the shared `Card` shell, not a hand-rolled bordered box. The delta's colour is a
 * `data-tone` token swap (`positive` / `danger` / `neutral`), the same vocabulary `Badge`, `Chip`
 * and `Banner` read, so both themes are tokens.css's decision and never this file's. The tile is
 * one of the two shapes the shared library has not built; it stays here under the two-module rule
 * and moves to `src/shared/ui/` the day a second module wants one.
 */
export function StatTiles({ tiles, collapseKey }: StatTilesProps) {
  const { t } = useTranslation('chat');

  return (
    <ShapeFrame kind="stats" title={t('shapes.titles.stats')} collapseKey={collapseKey}>
      {/* `auto-fill` rather than `auto-fit`: tiles keep one width whether there are two or six, so
          a lone tile does not stretch into a banner, and a phone still fits two to a row. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
        {tiles.map((tile, index) => {
          const tone = deltaTone(tile.delta);
          const Arrow = DELTA_ARROW[tone];
          return (
            <Card key={index} data-stat-tile className="flex min-w-0 flex-col gap-1.5 p-3">
              {/* Wrapped, never truncated: an ellipsis would render less than the author wrote. */}
              <span
                data-stat-label
                className="break-words text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {tile.label}
              </span>
              <span
                data-stat-value
                className="break-words font-serif text-3xl tabular-nums leading-none text-foreground"
              >
                {tile.value}
              </span>
              {tile.delta ? (
                <span
                  data-stat-delta
                  data-tone={tone}
                  className="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums text-[color:var(--tone-ink)]"
                >
                  {Arrow ? <Arrow aria-hidden="true" className="h-3.5 w-3.5 flex-none" /> : null}
                  <span className="break-words">{tile.delta}</span>
                </span>
              ) : null}
            </Card>
          );
        })}
      </div>
    </ShapeFrame>
  );
}
