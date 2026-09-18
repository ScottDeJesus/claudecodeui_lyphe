import { useTranslation } from 'react-i18next';

import { AppDrawer } from '@/modules/app-switcher/AppDrawer';
import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';
import { DockableFab } from '@/shared/ui';
import type { DockableFabPosition } from '@/shared/ui';

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
        // The app's own logo is the switcher's face; the kit fills the circle with an image glyph.
        icon={<img src="/logo-64.png" alt="" />}
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
