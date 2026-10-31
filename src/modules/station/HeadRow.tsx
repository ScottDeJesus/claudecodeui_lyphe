import { Ellipsis } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionStatus } from '@/modules/companion';
import { STATION_SIDEWAYS_CATCH } from '@/shared/constants';
import type { CompanionPresence, StationHeadRow } from '@/shared/types';
import { AppLogo, Button, buttonVariants, Menu } from '@/shared/ui';
import { cn } from '@/shared/utils';

type HeadRowProps = {
  /** What the phone's arrangement asks of her head: its sideways step, its `trail` and the way back. */
  row: StationHeadRow;
  /** Her face's box, drawn by `StationHeadView` at the row's size (44 px, 32 on its side). */
  face: ReactNode;
  /** Her name as he set it; `nameId` is its heading's id, which names the whole head. */
  name: string;
  nameId: string;
  /** What she is doing on this page, for her state's words. */
  presence: CompanionPresence;
  /** Her controls' line (`CompanionControls`, `line`, aligned to its start), drawn in her menu's panel while it is open. */
  controls: ReactNode;
  /** The most her menu's panel takes, in px: her head's own at compact. */
  panelWidth: number;
  /** A failed process's banner, under the row at its whole width; false while she runs. */
  banner: ReactNode;
};

/**
 * HER HEAD AS THE PHONE'S TOP ROW, the bar and her head in one under the status bar: drawn by `StationHeadView` (this module)
 * whenever the phone's arrangement hands her head its `row`. Left to right:
 *
 * - her face, 44 px (32 px on its side, where the row is 40 px);
 * - her name and her state on one line: her name keeps its width up to 40% of the line, her state takes the rest and gives way by
 *   its own rule (a chat's name cut, "· item 4 of 15" kept; words with no subject wrap rather than lose their end). Her state is
 *   the companion's small line (`panel`, as her panel's narrow head draws it): at the station's 16 px it had 110 px beside her
 *   name at 390, and "Asleep · your next message wakes her" lost "wakes her" and "· item 4 of 15" lost its 5; at 12 px its two
 *   lines (20 px each) stand whole beside her name, inside the 40 px row on its side too. Her words take their own width first
 *   (`flex: 1 1 auto`): what stands in the `trail` gives way before them.
 * - the arrangement's `trail`: the count of what needs him and, on its side, the strip's line;
 * - her ONE menu at the row's end, the glyph alone (a row this narrow has no room for its words; they are its name, "Her controls
 *   and CloudCLI"): its panel is her controls' line over "CloudCLI", the shell's way back, the bar's own press. The panel hangs
 *   under the row, so it never covers her face, and the kit's edge shift keeps it inside the window.
 *
 * Every press is a 44 px catch: upright by its size, on its side by a catch grown past the 40 px row (`STATION_SIDEWAYS_CATCH`).
 * A failed process's banner stands under the row at its whole width. `data-station-head="row"` reads the form.
 */
export function HeadRow({ row, face, name, nameId, presence, controls, panelWidth, banner }: HeadRowProps) {
  const { t } = useTranslation();
  const menuLabel = t('station.head.menu', { defaultValue: 'Her controls and CloudCLI' });

  return (
    <section data-station-head="row" data-station-head-sideways={row.sideways ? '' : undefined} aria-labelledby={nameId} className="flex min-w-0 flex-col px-3">
      {/* 56 px upright, so the row never moves as her state changes: her state stands on two lines at most (its own rule clamps
          it there), and every state's two fit beside her name down to 360 px (measured at 12 px, "Asleep · your next message
          wakes her" needs 112 px for two; the row gives it 118 at 360) but one: "Stopped · your next message starts her again"
          needs 142, so at 360 it loses its end ("…starts he…"), and the banner under the row carries the server's sentence. On
          its side 40 px: one line, or two at 20 px. Her words stand 8 px from her face and none from the presses after them:
          each of those is a 44 px catch round a 20 px glyph, 12 px of air already. */}
      <div className={cn('flex min-w-0 items-center', row.sideways ? 'h-10' : 'h-14 py-1')}>
        {face}
        <div className="ml-2 flex min-w-0 flex-[1_1_auto] items-baseline gap-x-2">
          {/* Her name on her state's 20 px line, so two lines of her state are the row's 40 px on its side and never more. */}
          <h2 id={nameId} data-station-head-name="" className="max-w-[40%] shrink-0 truncate text-base font-semibold leading-5 text-foreground">
            {name}
          </h2>
          <CompanionStatus presence={presence} emphasis="panel" />
        </div>
        {/* The trail and her menu side by side with no gap: each press is already a 44 px catch round a 20 px glyph. */}
        <div className="flex shrink-0 items-center">
          {row.trail}
          <Menu
            width={panelWidth}
            label={menuLabel}
            panel={(
              <div className="flex min-w-0 flex-col gap-3">
                {controls}
                <div className="border-t border-border pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    data-station-back-to-cloudcli=""
                    aria-label={t('station.bar.backLabel', { defaultValue: 'Back to CloudCLI' })}
                    className="h-11 w-full justify-start"
                    onClick={row.onBackToCloudcli}
                  >
                    <AppLogo size={64} className="size-4 rounded-[25%]" />
                    {t('station.bar.back', { defaultValue: 'CloudCLI' })}
                  </Button>
                </div>
              </div>
            )}
            trigger={(
              <span
                data-station-head-controls=""
                // The count's ink beside it: the ghost's accent green would say "healthy" on a press that says nothing of the sort.
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'relative text-foreground', row.sideways ? cn(STATION_SIDEWAYS_CATCH, 'w-11') : 'size-11')}
              >
                <Ellipsis aria-hidden="true" />
                <span className="sr-only">{menuLabel}</span>
              </span>
            )}
          />
        </div>
      </div>
      {banner !== false && <div className="pb-2">{banner}</div>}
    </section>
  );
}
