/** `Element.moveBefore` is not in the DOM typings this project builds against yet (Chromium 133 and later have it). */
type MovableParent = Element & { moveBefore: (node: Node, child: Node | null) => void };

/** The text field that held focus inside the node, and where its caret and selection stood. */
type HeldField = {
  field: HTMLInputElement | HTMLTextAreaElement;
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
};

function canMoveBefore(parent: Element): parent is MovableParent {
  return 'moveBefore' in parent;
}

/** The text field that has focus inside `node`, with its selection, or null when focus is elsewhere or on something that is not a text field. */
function holdFocusedField(node: Element): HeldField | null {
  const active = node.ownerDocument.activeElement;
  if (!active || !node.contains(active)) return null;
  const field = active as HTMLInputElement | HTMLTextAreaElement;
  try {
    const { selectionStart, selectionEnd, selectionDirection } = field;
    // A button, a link or a field type with no selection (a checkbox) answers null here: only a text
    // field has a caret to lose.
    if (typeof selectionStart !== 'number' || typeof selectionEnd !== 'number') return null;
    return { field, start: selectionStart, end: selectionEnd, direction: selectionDirection ?? 'none' };
  } catch (error) {
    // Some engines throw for a field type that has no selection rather than answering null.
    console.warn('[chat-host] a focused field has no selection to keep across the move', error);
    return null;
  }
}

/**
 * Gives a held field its focus and caret back after a move. The field is blurred first and then
 * focused, because a bare `focus()` on a field that still reports focus does nothing.
 */
function returnFocus({ field, start, end, direction }: HeldField): void {
  if (!field.isConnected) return;
  field.blur();
  field.focus({ preventScroll: true });
  field.setSelectionRange(start, end, direction);
}

/**
 * Makes `node` the last child of `parent`: an atomic `moveBefore` inside one document where the browser
 * has it (frames survive), else `append`. A text field that had focus in the node has it again, with its
 * caret where it stood.
 *
 * WHY THE TWO PATHS. `append` removes the node and inserts it again, and that reloads every iframe in it
 * and drops focus from anything inside it — the chat holds widget frames and a composer, and a move between
 * hosts must not reload the frames. `moveBefore` moves without removing. But it refuses a move across
 * documents (the picture-in-picture window is another document), and such a move always reloads frames
 * whatever is used, so `append` — which adopts the node into the new document — is the only honest call
 * there.
 *
 * WHY THE FOCUS IS GIVEN BACK BY HAND. Measured in Chromium 145 on a bare page with no app code:
 * `moveBefore` keeps `document.activeElement` and `:focus` on a moved textarea but resets its selection to
 * 0, and the editor then ignores key input until the field is blurred and focused again — a reader who
 * presses the chat's hotkey and keeps typing types into nothing. `append` drops focus entirely. Either way
 * the field is read before the move and blurred and focused again after it.
 *
 * `moveBefore` also refuses a node that is not in the same tree as its new parent, and the node's very
 * first placement is exactly that: it was created detached. Comparing the two roots sends that case to
 * `append` too, where there is nothing yet to keep.
 *
 * Used by chat-host's provider (`moveTo`), which every adoption of the chat's node goes through — the
 * slot at home, the panel and the window when they float.
 */
export function placeNode(node: Element, parent: Element): void {
  const held = holdFocusedField(node);
  const sameTree = node.ownerDocument === parent.ownerDocument && node.getRootNode() === parent.getRootNode();
  if (sameTree && canMoveBefore(parent)) {
    parent.moveBefore(node, null);
  } else {
    parent.append(node);
  }
  if (held) returnFocus(held);
}
