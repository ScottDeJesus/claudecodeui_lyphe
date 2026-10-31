import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import type { StationCompactSwitch } from '@/shared/types';
import { AppLogo, Button, Switch } from '@/shared/ui';
import { cn } from '@/shared/utils';

type StationBarProps = {
  /** The `strip` slot's region, drawn across the bar's middle; nothing while no region fills it, and nothing in compact. */
  strip: ReactNode;
  /** His "Compact" switch (the station pref `compact`, bound by `StationShell`), at the bar's right before "CloudCLI"; null where it would change nothing, and none is drawn. */
  compactSwitch: StationCompactSwitch | null;
  /** The press on "CloudCLI", the way back to the workspace (`StationShell` binds it). */
  onBackToCloudcli: () => void;
};

/**
 * THE STATION'S BAR, across the top of every arrangement: "Kaylee Station" in the page's serif title weight, its
 * second word in Verve's warm garnish (the station's one warm touch, never a wall); the `strip` slot across its
 * middle; and at its right his "Compact" switch, then "CloudCLI" with the app's own mark, the way back to the workspace.
 *
 * The title is the page's one `h1`. In compact (below 1024 px, and wherever his switch is on) the strip is a row of the
 * arrangement's own, under her head, and the bar holds none.
 *
 * "COMPACT" is the kit `Switch` with its word beside it, the two one label, so a press anywhere on it presses the switch: on,
 * the station is one column at any width (a portrait monitor, a window kept beside his work). It stands only where it changes
 * something, from 1024 px up; below, compact is the only arrangement and the switch is not drawn.
 *
 * THE TOUCH LAW: "CloudCLI" and the Compact label are 44 px catches under a finger below 768 px (and the label on any touch
 * screen); each says what it does in its own words ("Back to CloudCLI", "Compact"), so neither needs a tooltip.
 *
 * A pure view: the presses are the caller's. Drawn by `StationShellView` (this module), above the body of every arrangement.
 */
export function StationBar({ strip, compactSwitch, onBackToCloudcli }: StationBarProps) {
  const { t } = useTranslation();
  // A slot with no region draws nothing: no strip box, so the way back alone holds the right.
  const hasStrip = strip !== undefined && strip !== null && strip !== false;
  const compactLabel = t('station.compact.switch', { defaultValue: 'Compact' });

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
        <div data-station-slot="strip" className="flex min-w-0 flex-1">
          {strip}
        </div>
      )}
      {compactSwitch !== null && (
        // The switch carries the name; the word beside it is for the eye. The kit's 30 px switch gets the label's 44 px catch.
        <label
          data-station-compact-toggle={compactSwitch.on ? 'on' : 'off'}
          className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 max-md:min-h-11 [@media(pointer:coarse)]:min-h-11"
        >
          <span aria-hidden="true" className="text-sm font-medium text-foreground">{compactLabel}</span>
          <Switch checked={compactSwitch.on} label={compactLabel} onChange={compactSwitch.onChange} />
        </label>
      )}
      <Button
        variant="outline"
        size="sm"
        data-station-back-to-cloudcli=""
        aria-label={t('station.bar.backLabel', { defaultValue: 'Back to CloudCLI' })}
        className={cn('shrink-0 finger:h-11', compactSwitch === null && 'ml-auto')}
        onClick={onBackToCloudcli}
      >
        <AppLogo size={64} className="size-4 rounded-[25%]" />
        {t('station.bar.back', { defaultValue: 'CloudCLI' })}
      </Button>
    </header>
  );
}
