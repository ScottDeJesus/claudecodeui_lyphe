import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useChatHostMechanics } from '@/modules/chat-host/context/ChatHostContext';
import { usePanelViewport } from '@/modules/chat-host/hooks/usePanelViewport';
import { clampPanelSize, defaultPanelSize, panelPlacement } from '@/modules/chat-host/utils/panelGeometry';
import { readPanelSize, writePanelSize } from '@/modules/chat-host/utils/chatHostStorage';
import { FAB_SIZE_PX } from '@/shared/constants';

/** How far the kit's resting corner stands from the right and from the bottom (`RESTING_CORNER` in DockableFab). */
const RESTING_RIGHT_PX = 16;
const RESTING_BOTTOM_PX = 56;

/** Where the FAB rests when no rect has been reported for it: the kit's own bottom-right corner, spelt in this viewport. */
function restingAnchor(viewport: { width: number; height: number }) {
  return {
    left: viewport.width - FAB_SIZE_PX - RESTING_RIGHT_PX,
    top: viewport.height - FAB_SIZE_PX - RESTING_BOTTOM_PX,
    width: FAB_SIZE_PX,
    height: FAB_SIZE_PX,
  };
}

/** How far the FAB keeps from the bottom of the viewport (`VIEWPORT_EDGE_PX` in DockableFab), which the panel keeps from every edge too. */
const ANCHOR_EDGE_PX = 8;

/**
 * The FAB's rect, lifted if it stands below the room the panel has (the viewport less the virtual keyboard).
 *
 * The FAB does not move for a keyboard: it is `position: fixed` against the layout viewport, which a keyboard
 * leaves alone, so its reported rect can stand under the keyboard. A panel that stands above the FAB (the
 * phone's stance) would then stand above the keyboard's top edge only by luck — its composer would sit under
 * the keys. The panel stands above the FAB AS IF it stood at the lowest point still in view, so the stance is
 * the same and only the keyboard's room is honoured. Rects that are already in view come back unchanged. Built
 * field by field because the FAB's rect is a `DOMRect`, whose fields are getters a spread would not copy.
 */
function anchorInsideViewport(
  rect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
) {
  const lowestTop = Math.max(viewport.height - rect.height - ANCHOR_EDGE_PX, ANCHOR_EDGE_PX);
  return { left: rect.left, top: Math.min(rect.top, lowestTop), width: rect.width, height: rect.height };
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
 * chosen size back. The resize starts from the size DRAWN and stores the size DRAWN, never the size asked for:
 * beside the FAB the panel can be narrower than it was asked to be, and a grip measured against the wider
 * number would not move under the pointer until the pointer had travelled the difference back, and would store
 * a size the reader never saw.
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
  const anchorRect = anchorInsideViewport(anchor ?? restingAnchor(viewport), viewport);
  const placement = panelPlacement(anchorRect, size, viewport);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (bodyRef.current) moveTo(bodyRef.current, true);
  }, [moveTo]);

  // The size drawn at the press of the current resize; null between resizes. A ref because the gesture's
  // deltas are all measured from it and nothing draws from it.
  const resizeBaseRef = useRef<{ width: number; height: number } | null>(null);

  // Adds the grip's delta to the size at the press, for the grip's corner: a grip on the left grows the
  // width as `dx` goes negative, one on the top grows the height as `dy` goes negative. The result goes
  // through `panelPlacement` (which clamps it to the viewport and to the room beside the FAB) and what
  // comes out — the size that is drawn — is what is kept and what the release writes.
  function applyResize({ dx, dy }: { dx: number; dy: number }) {
    resizeBaseRef.current ??= { width: placement.width, height: placement.height };
    const base = resizeBaseRef.current;
    const drawn = panelPlacement(
      anchorRect,
      {
        width: base.width + (placement.grip.endsWith('left') ? -dx : dx),
        height: base.height + (placement.grip.startsWith('top') ? -dy : dy),
      },
      viewport,
    );
    const drawnSize = { width: drawn.width, height: drawn.height };
    setChosenSize(drawnSize);
    return drawnSize;
  }

  function onResize(delta: { dx: number; dy: number }) {
    applyResize(delta);
  }

  function onResizeEnd(delta: { dx: number; dy: number }) {
    writePanelSize(applyResize(delta));
    resizeBaseRef.current = null;
  }

  return { placement, bodyRef, onResize, onResizeEnd };
}
