import { useEffect, useMemo } from 'react';

import { useChatHostMechanics } from '@/modules/chat-host/context/ChatHostContext';
import { mirrorDocument } from '@/modules/chat-host/utils/mirrorDocument';

/** The window's body layout: a column that holds a header container and, under it, the chat container the chat's node is carried into. */
type WindowColumn = { column: HTMLElement; headerContainer: HTMLElement; chatContainer: HTMLElement };

/**
 * Builds the column in the window's document, detached. The column is an element of its own rather than the
 * body's `style`, because the mirror rewrites the body's `style` whenever the opener's changes (a dialog's
 * `overflow: hidden`) and would take a layout kept there with it. Margin 0, full height, a flex column; the
 * chat container takes what the header leaves and may shrink below its content (`min-height: 0`), so the
 * transcript scrolls inside it and never pushes the window.
 */
function buildWindowColumn(pip: Window): WindowColumn {
  const pipDocument = pip.document;
  const column = pipDocument.createElement('div');
  column.style.cssText = 'margin:0;height:100dvh;display:flex;flex-direction:column;';
  const headerContainer = pipDocument.createElement('div');
  headerContainer.style.cssText = 'flex:none;min-width:0;';
  const chatContainer = pipDocument.createElement('div');
  chatContainer.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;';
  column.append(headerContainer, chatContainer);
  return { column, headerContainer, chatContainer };
}

/**
 * Everything a picture-in-picture window needs to become the chat's host, in the order it must happen. Answers
 * the element the window's header is drawn into, which `ChatHostWindow` portals `ChatHostHeader` into.
 *
 * Used by this module's ChatHostWindow, which mounts once per window: `open()` has already got the window and
 * set the placement to 'window', so this hook is the window's whole life from there to its end.
 *
 *  1. `mirrorDocument(document, pip.document)` runs FIRST, so the window's document is being styled before
 *     anything is put in it. `document` is the opener's, on purpose: the mirror copies FROM the opener.
 *  2. The window's body gets its column: a header container and a chat container. The header is drawn into its
 *     container at once, before the chat is carried in, so the chat is laid out at the height it will keep.
 *  3. Once the mirror's `ready` resolves — the cloned stylesheets have loaded, so the chat is never shown
 *     before its styles — `moveTo(chatContainer, true)` carries the chat in. The wait is guarded by a flag:
 *     `ready` also settles when the mirror is stopped, and a window that has already gone has no chat to receive.
 *  4. On the window's `pagehide` the chat comes home: `comeHome()` moves the node to the chat tab
 *     SYNCHRONOUSLY (the window is unloading, and its document is the last place the chat may stand), then
 *     settles the placement at 'home', and only then does `mirror.stop()` let go of the window's sheets.
 *
 * `pagehide` is the ONE path out. The header's collapse, the FAB, the hotkey and "Bring it back" all call
 * `collapse()`, which only closes the window; the window's own close button and the browser's "back to tab"
 * close it themselves; all of them arrive here.
 *
 * THE COLUMN IS BUILT DURING RENDER AND ONLY ATTACHED IN THE EFFECT. It is made once per window (`useMemo`) and
 * no state is set from the effect: React's StrictMode mounts an effect, cleans it up and mounts it again, and a
 * container handed to state from each mount was rendered from the FIRST (discarded) mount's column in
 * development — the header landed in a detached element and appeared only on the next render, after the chat
 * had already been laid out without it. The same element across both mounts cannot disagree with itself.
 *
 * The cleanup is not a way out and does not close the window: a cleanup that closed it would end every window in
 * development. It undoes what this effect built (the listener, the mirror, the column's place in the body) and
 * nothing more.
 */
export function usePictureInPicture(pip: Window): HTMLElement {
  const { moveTo, comeHome } = useChatHostMechanics();
  const windowColumn = useMemo(() => buildWindowColumn(pip), [pip]);

  useEffect(() => {
    const { column, chatContainer } = windowColumn;
    const mirror = mirrorDocument(document, pip.document);
    pip.document.body.append(column);

    let wanted = true;
    void mirror.ready.then(() => {
      if (wanted) moveTo(chatContainer, true);
    });

    function handlePageHide() {
      wanted = false;
      comeHome();
      mirror.stop();
    }
    pip.addEventListener('pagehide', handlePageHide);
    // A window closed between the browser making it and this listener being attached fires no `pagehide`
    // the listener can hear; without this the placement would stay 'window' with nothing to close.
    if (pip.closed) handlePageHide();

    return () => {
      wanted = false;
      pip.removeEventListener('pagehide', handlePageHide);
      mirror.stop();
      column.remove();
    };
  }, [pip, windowColumn, moveTo, comeHome]);

  return windowColumn.headerContainer;
}
