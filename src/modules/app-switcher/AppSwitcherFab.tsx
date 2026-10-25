import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppDrawer } from '@/modules/app-switcher/AppDrawer';
import { AppSwitcherRadial } from '@/modules/app-switcher/AppSwitcherRadial';
import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';
import { useSwitcherActions } from '@/modules/app-switcher/hooks/useSwitcherActions';
import { radialLayout } from '@/modules/app-switcher/utils/radialLayout';
import type { ChatDoor } from '@/shared/types';
import { AppLogo, DockableFab } from '@/shared/ui';
import type { DockableFabPosition } from '@/shared/ui';

/** The same box: the kit reports a fresh `DOMRect` per placement, and only a moved or resized one is news. */
function sameRect(a: DOMRect, b: DOMRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

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
 * A TAP COLLAPSES A FLOATING CHAT; else, SEATED while the rail has handed the dock a press override (`dockPress`: the
 * chat list is collapsed and the rail names the way back), it runs that override — "Show the chat list" — instead; else
 * it opens the radial of the acts that can run (`useSwitcherActions`, less any it marks `disabled`): Chat and
 * Applications with no application up, all five with one up; a second tap closes it. Which press goes which way is
 * decided here, where the FAB, its seat and its drag live; the rail only says what the override is. A disc dragged out
 * of its dock is not seated, so its tap opens the radial, and the dock draws its own button for the override. With the
 * override up the radial stays reachable from the palette's Applications group. The drawer is one of them — Applications — so it stays reachable from the FAB at every moment,
 * and the FAB reads as pressed while either the radial or the drawer is up. The radial closes when a drag
 * starts (the button is about to move out from under its arc) and when the chat starts floating (the reader's
 * attention has moved to the chat, and its Chat act has become Collapse). The label says what a tap will do,
 * and while a reply waits out of sight and the FAB floats the dot shows and the label says so.
 *
 * SEATED IN THE RAIL (docked, with a dock measured), the FAB draws no dot and its label does not carry the unread
 * words: the views rail is where badges live, and its Chat glyph wears the badge 1 for the same reply. A rail has no
 * bare dot, and a collapsed rail still says a reply landed. The one exception is a window too short for the rail,
 * where the rail's region scrolls and can take the Chat glyph out of sight: the dock then reports the badge hidden
 * (`dockBadgeHidden`) and the seated disc draws the dot, so a waiting reply is never unsigned.
 *
 * `chatDoor` is the chat's one door, handed in by project-workspace, which alone knows which conversation an
 * application brings; this module never imports the chat's host. `onAnchorChange` is how the floating chat
 * knows where to stand: the kit reports the button's measured rect after every placement and window resize,
 * this passes each one on (and keeps it to draw the radial's arc around), and it reports `null` when the FAB
 * unmounts so nothing keeps standing beside a button that is gone. The owner wires it (project-workspace's
 * WorkspaceFrame hands chat-host's `reportAnchor`).
 */
export function AppSwitcherFab({
  chatDoor,
  onAnchorChange,
}: {
  chatDoor: ChatDoor;
  onAnchorChange: (rect: DOMRect | null) => void;
}) {
  const { t } = useTranslation();
  const { fabPosition, dockRect, dockBadgeHidden, dockPress, drawerOpen, moveFab } = useAppSwitcher();
  const acts = useSwitcherActions(chatDoor);
  // The acts the radial draws: the ones that can run, and no others, so nothing in the arc is a dead press and
  // the arc is laid out for exactly what it shows. (The command palette draws the whole list, `disabled` and all.)
  const runnableActs = useMemo(() => acts.filter((act) => !act.disabled), [acts]);

  // How the radial is open, or null while it is closed. State because only the FAB draws the radial, and the
  // FAB's tap, its drag and the chat's float are what open and close it. The input that opened it is kept in
  // the same value as the open flag: a keyboard open moves focus into the arc, a pointer open leaves it be.
  const [radialOpenedBy, setRadialOpenedBy] = useState<'pointer' | 'keyboard' | null>(null);
  // The chat starting to float puts the radial away: a radial left open would go on offering "Chat" for a
  // chat that is already out. Dropped in the render that finds the chat floating, so no frame draws both.
  if (chatDoor.floating && radialOpenedBy !== null) setRadialOpenedBy(null);
  const radialOpen = radialOpenedBy !== null && !chatDoor.floating;
  // The acts as the radial last drew them while open. State because they must outlive the render that closes it:
  // pressing Close app takes the application down in the same event, which would pull three items out of the
  // arc, and move the two that stay, in the middle of the close's fade. The radial follows the live acts only
  // while it is open, and is drawn from these while it fades.
  const [drawnActs, setDrawnActs] = useState(runnableActs);
  if (radialOpen && drawnActs !== runnableActs) setDrawnActs(runnableActs);
  const radialActs = radialOpen ? runnableActs : drawnActs;

  // The FAB's rect as the kit last measured it. State because the radial's arc is drawn around it and must
  // follow it (a resize, or the docked FAB's row moving); the same rect goes to the chat's host.
  const [fabRect, setFabRect] = useState<DOMRect | null>(null);

  // The latest `onAnchorChange`, so the report on unmount reaches the owner's current function whatever
  // the owner passed the render before. The kit re-reports only when a placement input changes, so an
  // effect keyed on the callback would clear the anchor on every new function and never restore it.
  const anchorListener = useRef(onAnchorChange);
  useLayoutEffect(() => {
    anchorListener.current = onAnchorChange;
  });
  useEffect(() => () => anchorListener.current(null), []);

  // Read at the render, as the radial reads them: the arc is fitted to the viewport as it is now.
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const actCount = radialActs.length;
  // Worked out whether the radial is open or not: a close is drawn, so the items keep their points through
  // the fade. Empty until the kit has measured the FAB once.
  const points = useMemo(
    () => (fabRect === null ? [] : radialLayout(fabRect, { width: viewportWidth, height: viewportHeight }, actCount)),
    [fabRect, viewportWidth, viewportHeight, actCount],
  );
  // The arc's centre, which the radial hangs its labels around.
  const origin = useMemo(
    () => (fabRect === null ? null : { x: fabRect.left + fabRect.width / 2, y: fabRect.top + fabRect.height / 2 }),
    [fabRect],
  );

  function handleRectChange(rect: DOMRect) {
    setFabRect((previous) => (previous !== null && sameRect(previous, rect) ? previous : rect));
    onAnchorChange(rect);
  }

  // Seated: docked on a dock that measured. The kit's own test for "drawn in the dock", less the drag in hand.
  const seated = fabPosition.docked && dockRect !== null;
  // The press the rail asked the seated disc to run in place of the radial, or null. One value for the press and the
  // label below, so what the label says is what the press does.
  const seatedPress = seated ? dockPress : null;

  // A press that never became a drag, or Enter/Space. A floating chat is put away; else a seated disc runs the rail's
  // override; otherwise the press toggles the radial, so the FAB closes what it opened.
  function handlePress({ keyboard }: { keyboard: boolean }) {
    if (chatDoor.floating) {
      chatDoor.collapse();
      return;
    }
    if (seatedPress !== null) {
      seatedPress.run();
      return;
    }
    setRadialOpenedBy((current) => (current === null ? (keyboard ? 'keyboard' : 'pointer') : null));
  }

  // Exactly once per drag, at release: docked, or the clamped point where the reader let go.
  function handlePositionChange(next: DockableFabPosition) {
    moveFab(next);
  }

  // What a press will do, in words; the label is the tooltip too. The dot is aria-hidden, so what it means is
  // said here, after what the press does — and only while the dot is drawn: seated, the rail's Chat badge says it,
  // unless the rail has scrolled that badge out of sight.
  const pressLabel = chatDoor.floating
    ? t('applications.fabLabelCollapse')
    : seatedPress !== null
      ? seatedPress.label
      : t('applications.fabLabelMenu');
  const showsDot = chatDoor.unread && !chatDoor.floating && (!seated || dockBadgeHidden);

  return (
    <>
      <DockableFab
        label={showsDot ? `${pressLabel} — ${t('applications.fabUnread')}` : pressLabel}
        // The app's own logo is the switcher's face; the kit fills the circle with an image glyph.
        icon={<AppLogo size={64} />}
        position={fabPosition}
        dockRect={dockRect}
        active={radialOpen || drawerOpen}
        indicator={showsDot}
        onPress={handlePress}
        onDragStart={() => setRadialOpenedBy(null)}
        onPositionChange={handlePositionChange}
        onRectChange={handleRectChange}
      />
      <AppSwitcherRadial
        open={radialOpen}
        openedByKeyboard={radialOpenedBy === 'keyboard'}
        acts={radialActs}
        points={points}
        origin={origin}
        onClose={() => setRadialOpenedBy(null)}
      />
      <AppDrawer />
    </>
  );
}
