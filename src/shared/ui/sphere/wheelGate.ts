import type { Viewer } from '@photo-sphere-viewer/core';

/** The overlay's id, so a Control-wheel can take back the hint it is answering, and nothing else's overlay. */
const HINT_ID = 'ctrl-zoom';

/** How long the hint stays up: the library's own `CTRLZOOM_TIMEOUT`. */
const HINT_MS = 2000;

/** The library sets an overlay's title as innerHTML, and the hint is a translated sentence: a `<` or `&` in it stays text. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Gates the viewer's wheel so that a page which scrolls past a sphere keeps scrolling, and a zoom is asked for.
 *
 * The library has this gate (`mousewheelCtrlKey`) but it reads the Control KEY alone, from a window keydown: ⌘ never zooms
 * on a Mac, and a trackpad pinch (a wheel that carries `ctrlKey` with no key down) shows the hint while the browser zooms
 * the page. So the option stays off and this listener is the gate, on the element the viewer was handed, in the capture
 * phase so that it runs before the library's own listener on the container inside it:
 *  - a wheel with `ctrlKey` or `metaKey` goes on to the library, which zooms and keeps the page from zooming;
 *  - any other is stopped here, with `stopPropagation` and never `preventDefault`, so the page scrolls on, and shows the
 *    library's own overlay in the caller's words. A fullscreen viewer has no page to scroll: its wheel zooms.
 * The listener is passive because it never prevents anything. A wheel with no vertical delta is the library's to ignore.
 *
 * Returns the function that takes the listener and the pending hide down.
 */
export function gateWheel(stage: HTMLElement, viewer: Viewer, hint: () => string): () => void {
  let hideTimer: number | undefined;

  const onWheel = (event: WheelEvent) => {
    if (!event.deltaY || viewer.isFullscreenEnabled()) return;
    if (event.ctrlKey || event.metaKey) {
      // The zoom is asked for: the hint has done its work.
      viewer.overlay.hide(HINT_ID);
      return;
    }
    event.stopPropagation();
    viewer.overlay.show({ id: HINT_ID, title: escapeHtml(hint()) });
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => viewer.overlay.hide(HINT_ID), HINT_MS);
  };

  stage.addEventListener('wheel', onWheel, { capture: true, passive: true });
  return () => {
    stage.removeEventListener('wheel', onWheel, { capture: true });
    window.clearTimeout(hideTimer);
  };
}
