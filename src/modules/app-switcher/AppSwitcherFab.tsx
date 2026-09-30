import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { AppDrawer } from '@/modules/app-switcher/AppDrawer';
import { AppSwitcherRadial } from '@/modules/app-switcher/AppSwitcherRadial';
import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';
import { AppLogo, DockableFab } from '@/shared/ui';
import type { DockableFabPosition } from '@/shared/ui';

/**
 * The switcher's one control on screen: the kit's DockableFab, the radial that fans out from it, and the
 * drawer.
 *
 * Mounted by the project-workspace shell as the last child of its fixed container, OUTSIDE the
 * main region, so it floats over an open application instead of being covered by it — it is the
 * reader's way out of a pane. The drawer hangs here rather than in the layer because it must open
 * with no application up at all, which is the state the reader starts in. The radial is its sibling, never
 * its parent: the FAB is one node for its whole life (DockableFab.tsx), and a radial drawn inside it would
 * unmount it — and the pointer capture of a drag — whenever the radial changed.
 *
 * The radial is mounted closed and the press still opens the drawer: the press moves to the radial in the
 * change that fills these markers in, together with the Applications act that reaches the drawer from it.
 *
 * `onAnchorChange` is how the floating chat knows where to stand: the kit reports the button's measured
 * rect after every placement and window resize, this passes each one on, and it reports `null` when the FAB
 * unmounts so nothing keeps standing beside a button that is gone. The owner wires it (project-workspace's
 * WorkspaceFrame hands chat-host's `reportAnchor`); this module never imports the chat's host.
 */
export function AppSwitcherFab({ onAnchorChange }: { onAnchorChange: (rect: DOMRect | null) => void }) {
  const { t } = useTranslation();
  const { fabPosition, dockRect, drawerOpen, setDrawerOpen, moveFab } = useAppSwitcher();

  // The latest `onAnchorChange`, so the report on unmount reaches the owner's current function whatever
  // the owner passed the render before. The kit re-reports only when a placement input changes, so an
  // effect keyed on the callback would clear the anchor on every new function and never restore it.
  const anchorListener = useRef(onAnchorChange);
  useLayoutEffect(() => {
    anchorListener.current = onAnchorChange;
  });
  useEffect(() => () => anchorListener.current(null), []);

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
        // FILL: label — "collapse" while the chat floats, "the menu" otherwise
        // The two branches read `applications.fabLabelCollapse` and `applications.fabLabelMenu`. While the dot
        // shows, `applications.fabUnread` is appended to the label: the dot is aria-hidden, so the label is its
        // only description, and the label is the tooltip too. `applications.fabLabel` goes when they land.
        label={t('applications.fabLabel')}
        // The app's own logo is the switcher's face; the kit fills the circle with an image glyph.
        icon={<AppLogo size={64} />}
        position={fabPosition}
        dockRect={dockRect}
        active={drawerOpen}
        indicator={false /* FILL: chatDoor.unread && !chatDoor.floating */}
        onPress={handlePress}
        onPositionChange={handlePositionChange}
        onRectChange={onAnchorChange}
      />
      <AppSwitcherRadial
        open={false /* FILL: radial-open */}
        acts={[] /* FILL: acts — useSwitcherActions(chatDoor) */}
        points={[] /* FILL: points — radialLayout(fabRect, viewport, acts.length) */}
        onClose={() => { /* FILL: close */ }}
      />
      <AppDrawer />
    </>
  );
}
