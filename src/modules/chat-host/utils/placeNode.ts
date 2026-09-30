/** `Element.moveBefore` is not in the DOM typings this project builds against yet (Chromium 133 and later have it). */
type MovableParent = Element & { moveBefore: (node: Node, child: Node | null) => void };

function canMoveBefore(parent: Element): parent is MovableParent {
  return 'moveBefore' in parent;
}

/**
 * Makes `node` the last child of `parent`: an atomic `moveBefore` inside one document where the browser
 * has it (focus and frames survive), else `append`.
 *
 * WHY THE TWO PATHS. `append` removes the node and inserts it again, and that reloads every iframe in it
 * and drops focus from anything inside it — the chat holds a composer with the caret in it and widget
 * frames, and a move between hosts must keep both. `moveBefore` moves without removing. But it refuses a
 * move across documents (the picture-in-picture window is another document), and such a move always
 * reloads frames whatever is used, so `append` — which adopts the node into the new document — is the
 * only honest call there.
 *
 * `moveBefore` also refuses a node that is not in the same tree as its new parent, and the node's very
 * first placement is exactly that: it was created detached. Comparing the two roots sends that case to
 * `append` too, where there is nothing yet to keep.
 *
 * Used by chat-host's provider (`moveTo`) and its slot, which adopt the chat's node into each host.
 */
export function placeNode(node: Element, parent: Element): void {
  const sameTree = node.ownerDocument === parent.ownerDocument && node.getRootNode() === parent.getRootNode();
  if (sameTree && canMoveBefore(parent)) {
    parent.moveBefore(node, null);
    return;
  }
  parent.append(node);
}
