import { useTranslation } from 'react-i18next';

import { AppPane } from '@/modules/app-switcher/AppPane';
import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';
import type { PaneSlot } from '@/modules/app-switcher/context/AppSwitcherContext';
import type { AppEntry } from '@/shared/app-types';
import { SplitPane } from '@/shared/ui';

/** An app on screen: the registry row, its resolved url, and the nonce its frame is keyed on. */
type PaneApp = { app: AppEntry; src: string; reloadNonce: number };

/**
 * What the layer draws, as SplitPane takes it. A lone application sits in the LEFT slot, because
 * `SplitPane` draws its left child whether or not there is a right one — and the provider keeps it
 * there (`loneAppOnTheLeft`), so the half that is drawn and the half the state names are one half.
 * `right` is non-null only with dual screen on AND two apps chosen, which is what keeps the divider
 * off a split that has nothing on one side of it.
 */
type PaneApps = { left: PaneApp | null; right: PaneApp | null };

/**
 * The open applications, over the MAIN REGION only.
 *
 * Mounted by the project-workspace shell as the last child of the main-region wrapper, which is
 * `relative` for it. It never covers the sidebar: the sidebar is how the reader gets back to a
 * project, and CloudCLI stays the shell while an application is up. The workspace underneath keeps
 * running — a streaming chat keeps streaming — because this is a layer over it, not a route.
 *
 * `z-40` sits over everything the main region draws (its sticky rows are z-10 and z-20) and under
 * the mobile sidebar drawer (z-50, the same stacking context), so the drawer still slides in over
 * an open application on a phone. The FAB, at 60, stays above both.
 */
export function AppSwitcherLayer() {
  const { t } = useTranslation();
  const { apps, panes, dual, ratio, setRatio } = useAppSwitcher();

  // A side's app: the registry row (for the frame's title) and the url the open site resolved. A row
  // the registry no longer holds reads as nothing at all — framing an address this app cannot name
  // would be a pane with no title and no way to say what is in it.
  function paneOf(slot: PaneSlot): PaneApp | null {
    if (slot.appId === null || slot.src === null) return null;
    const app = apps.find((entry) => entry.id === slot.appId);
    return app ? { app, src: slot.src, reloadNonce: slot.reloadNonce } : null;
  }

  const left = paneOf(panes.left);
  const right = dual ? paneOf(panes.right) : null;
  const paneApps: PaneApps = {
    // The left slot, or — for a state no action can leave behind, since the provider moves a survivor
    // left — the right slot's app filling rather than vanishing. One application up always fills the
    // layer, and the divider stands only when BOTH sides hold one, so a split can never be one
    // application drawn twice.
    left: left ?? right,
    right: left ? right : null,
  };

  // Nothing up: nothing drawn, and the workspace is exactly as it was.
  if (paneApps.left === null) return null;

  return (
    <div className="absolute inset-0 z-40 flex bg-background">
      <SplitPane
        ratio={ratio}
        onRatioChange={setRatio}
        left={
          <AppPane
            key={`${paneApps.left.app.id}:${paneApps.left.reloadNonce}`}
            src={paneApps.left.src}
            title={paneApps.left.app.name}
          />
        }
        right={
          paneApps.right ? (
            <AppPane
              key={`${paneApps.right.app.id}:${paneApps.right.reloadNonce}`}
              src={paneApps.right.src}
              title={paneApps.right.app.name}
            />
          ) : null
        }
        dividerLabel={t('applications.divider')}
      />
    </div>
  );
}
