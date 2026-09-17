import { useTranslation } from 'react-i18next';

import { AppDrawer } from '@/modules/app-switcher/AppDrawer';
import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';
import { DockableFab } from '@/shared/ui';
import type { DockableFabPosition } from '@/shared/ui';

/**
 * The design's three-bar glyph: two full bars over a short one, drawn on a 12px square so it lands
 * 1:1 in the kit's `--vv-fab-glyph`. Bars 1.5 thick with 2.5 between them, the short one centred —
 * the three `div`s of the `fabDown` button in design/Applications Hub.dc.html. `currentColor`, so it
 * takes `--on-accent` from the circle and stays readable on the dark accent too.
 */
function DrawerGlyph() {
  return (
    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="0" y="1.25" width="12" height="1.5" rx="0.75" />
      <rect x="0" y="5.25" width="12" height="1.5" rx="0.75" />
      <rect x="2" y="9.25" width="8" height="1.5" rx="0.75" />
    </svg>
  );
}

/**
 * The switcher's one control on screen: the kit's DockableFab, and the drawer it opens.
 *
 * Mounted by the project-workspace shell as the last child of its fixed container, OUTSIDE the
 * main region, so it floats over an open application instead of being covered by it — it is the
 * reader's way out of a pane. The drawer hangs here rather than in the layer because it must open
 * with no application up at all, which is the state the reader starts in.
 */
export function AppSwitcherFab() {
  const { t } = useTranslation();
  const { fabPosition, dockRect, drawerOpen, setDrawerOpen, moveFab } = useAppSwitcher();

  // A press that never became a drag, or Enter/Space. It toggles, so the FAB closes what it opened.
  function handlePress() {
    setDrawerOpen(!drawerOpen);
  }

  // Exactly once per drag, at release: docked, or the clamped point where the reader let go.
  function handlePositionChange(next: DockableFabPosition) {
    moveFab(next);
  }

  return (
    <>
      <DockableFab
        label={t('applications.fabLabel')}
        icon={<DrawerGlyph />}
        position={fabPosition}
        dockRect={dockRect}
        active={drawerOpen}
        onPress={handlePress}
        onPositionChange={handlePositionChange}
      />
      <AppDrawer />
    </>
  );
}
