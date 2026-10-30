import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import type { StationTier } from '@/shared/types';
import { AppLogo, Button } from '@/shared/ui';
import { cn } from '@/shared/utils';

type StationBarProps = {
  /** The arrangement the bar is drawn in: below laptop the strip takes a line of its own. */
  tier: StationTier;
  /** The `strip` slot's region, drawn across the bar's middle; nothing while no region fills it. */
  strip: ReactNode;
  /** The press on "CloudCLI", the way back to the workspace (`StationShell` binds it). */
  onBackToCloudcli: () => void;
};

/**
 * THE STATION'S BAR, across the top of every arrangement: "Kaylee Station" in the page's serif title weight, its
 * second word in Verve's warm garnish (the station's one warm touch, never a wall); the `strip` slot across its
 * middle; and at its right "CloudCLI" with the app's own mark, the way back to the workspace.
 *
 * The title is the page's one `h1`. Below laptop (`narrow`, a phone included) the strip drops to a line of its own
 * under the title, so the title and the way back keep the first line whatever the strip holds. "CloudCLI" is a 44 px
 * catch under a finger below 768 px (the touch law), and its name says where it goes ("Back to CloudCLI"), so it needs
 * no tooltip.
 *
 * A pure view: the press is the caller's. Drawn by `StationShellView` (this module), above the body of every tier.
 */
export function StationBar({ tier, strip, onBackToCloudcli }: StationBarProps) {
  const { t } = useTranslation();
  const narrow = tier === 'narrow';
  // A slot with no region draws nothing: no strip box, so the way back alone holds the right.
  const hasStrip = strip !== undefined && strip !== null && strip !== false;

  return (
    <header
      data-station-bar=""
      className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2"
    >
      <h1 className="shrink-0 font-serif text-[22px] font-normal leading-none text-foreground">
        <Trans
          t={t}
          i18nKey="station.bar.title"
          defaults="Kaylee <accent>Station</accent>"
          components={{ accent: <em className="text-garnish" /> }}
        />
      </h1>
      {hasStrip && (
        <div data-station-slot="strip" className={cn('flex min-w-0', narrow ? 'order-last basis-full' : 'flex-1')}>
          {strip}
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        data-station-back-to-cloudcli=""
        aria-label={t('station.bar.backLabel', { defaultValue: 'Back to CloudCLI' })}
        className="ml-auto shrink-0 max-md:h-11"
        onClick={onBackToCloudcli}
      >
        <AppLogo size={64} className="size-4 rounded-[25%]" />
        {t('station.bar.back', { defaultValue: 'CloudCLI' })}
      </Button>
    </header>
  );
}
