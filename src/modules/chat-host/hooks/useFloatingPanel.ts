import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useChatHostMechanics } from '@/modules/chat-host/context/ChatHostContext';
import { usePanelViewport } from '@/modules/chat-host/hooks/usePanelViewport';
import { clampPanelSize, defaultPanelSize, panelPlacement } from '@/modules/chat-host/utils/panelGeometry';
import { readPanelSize, writePanelSize } from '@/modules/chat-host/utils/chatHostStorage';

/** The FAB's drawn size (`--vv-fab-size` in surfaces.css), the size of the rect it rests as. */
const RESTING_FAB_PX = 28;
/** How far the kit's resting corner stands from the right and from the bottom (`RESTING_CORNER` in DockableFab). */
const RESTING_RIGHT_PX = 16;
const RESTING_BOTTOM_PX = 56;

/** Where the FAB rests when no rect has been reported for it: the kit's own bottom-right corner, spelt in this viewport. */
function restingAnchor(viewport: { width: number; height: number }) {
  return {
    left: viewport.width - RESTING_FAB_PX - RESTING_RIGHT_PX,
    top: viewport.height - RESTING_FAB_PX - RESTING_BOTTOM_PX,
    width: RESTING_FAB_PX,
    height: RESTING_FAB_PX,
  };
}

/**
 * Everything the floating panel decides, so `ChatHostPanel` can stay a frame that measures nothing: where it
 * stands, the body it adopts the chat's node into, and what the resize grip does.
 *
 * Used by this module's `ChatHostFloating`, in a component that exists only while the chat floats in the
 * panel — which is what makes the anchor read below cost nothing at home: the FAB reports its rect on
 * every frame of a drag, and only a mounted panel is subscribed to hear it.
 *
 * THE SIZE is what the reader chose (or the default), and the size DRAWN is that choice held to the viewport
 * on every render, so a window shrunk under the panel shrinks the panel and a window grown again gives the
 * chosen size back. The resize starts from the size DRAWN, not the size chosen: beside the FAB the panel can be
 * narrower than it was asked to be, and a grip that grew from the wider number would not move under the
 * pointer until the delta had eaten the difference.
 *
 * THE BODY ADOPTS THE NODE in a layout effect, before the browser paints, so the chat is never drawn
 * between hosts. It does not give the node back: collapse carries it home while the panel is still mounted.
 */
export function useFloatingPanel() {
  const { moveTo, anchorStore } = useChatHostMechanics();
  const anchor = useSyncExternalStore(anchorStore.subscribe, anchorStore.getSnapshot);
  const viewport = usePanelViewport();

  // The size the reader gave the panel, seeded from storage or the default. State because it changes as the
  // grip is dragged and nothing else holds it; it is written to storage once per resize, on release.
  const [chosenSize, setChosenSize] = useState(() => readPanelSize() ?? defaultPanelSize(viewport));
  const size = clampPanelSize(chosenSize, viewport);
  const placement = panelPlacement(anchor ?? restingAnchor(viewport), size, viewport);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (bodyRef.current) moveTo(bodyRef.current, true);
  }, [moveTo]);

  // The size drawn at the press of the current resize; null between resizes. A ref because the gesture's
  // deltas are all measured from it and nothing draws from it.
  const resizeBaseRef = useRef<{ width: number; height: number } | null>(null);

  // Adds the grip's delta to the size at the press, for the grip's corner: a grip on the left grows the
  // width as `dx` goes negative, one on the top grows the height as `dy` goes negative. Answers the
  // clamped size it set, which the release writes.
  const applyResize = useCallback(({ dx, dy }: { dx: number; dy: number }) => {
    resizeBaseRef.current ??= { width: placement.width, height: placement.height };
    const base = resizeBaseRef.current;
    const next = clampPanelSize(
      {
        width: base.width + (placement.grip.endsWith('left') ? -dx : dx),
        height: base.height + (placement.grip.startsWith('top') ? -dy : dy),
      },
      viewport,
    );
    setChosenSize(next);
    return next;
  }, [placement.width, placement.height, placement.grip, viewport]);

  const onResize = useCallback((delta: { dx: number; dy: number }) => {
    applyResize(delta);
  }, [applyResize]);

  const onResizeEnd = useCallback((delta: { dx: number; dy: number }) => {
    writePanelSize(applyResize(delta));
    resizeBaseRef.current = null;
  }, [applyResize]);

  return { placement, bodyRef, onResize, onResizeEnd };
}
