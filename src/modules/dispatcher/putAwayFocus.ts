/**
 * Where the keyboard lands after a press took the pressed control away with its card: a corner's
 * Dismiss or Hide, a menu action that emptied its menu, or a home's `Dismiss done · N`. A focused node
 * that unmounts drops focus to `<body>`, which throws a keyboard reader back to the top of the
 * document, so every one of those presses hands focus on through `landFocusInHome`.
 *
 * THE LAST PLACE IS THE HOME ITSELF. A press that empties the board (the last done card dismissed,
 * with nothing hidden) leaves no corner and no `Hidden · N` trigger to land on, so both homes carry
 * `tabIndex={-1}`: reachable by this hand-off, and never a stop of the Tab order.
 *
 * Used by `LaneCardHead` (a corner press, `putAwayKeepingFocus`, and a menu action,
 * `selectKeepingFocus`) and by the runner-tab module's two homes (`Dismiss done · N`, through
 * `landFocusInHome`).
 */

/** The two homes a card is drawn in; an heir is only ever looked for in the SAME one. */
const LANE_HOME = '[data-runner-panel], [data-runner-widget]';

/** Every corner press on the lane: an unfinished card's Hide and a done card's Dismiss. */
const PUT_AWAY_PRESS = '[data-dispatcher-hide], [data-dispatcher-dismiss]';

/** Whether a control can take focus now: attached, painted, and not inside a folded (`inert`) body. */
function canFocus(element: HTMLElement): boolean {
  return element.isConnected && element.getClientRects().length > 0 && element.closest('[inert]') === null;
}

/**
 * Focuses the first of `preferred` that can take it, else the home's first corner press, else its
 * `Hidden · N` trigger, else the home. Call it on the frame AFTER the press, once the store's
 * synchronous write has re-rendered the home.
 */
export function landFocusInHome(home: HTMLElement, preferred: readonly (HTMLElement | null)[] = []): void {
  const heir = [...preferred, ...home.querySelectorAll<HTMLElement>(PUT_AWAY_PRESS)]
    .find((element): element is HTMLElement => element !== null && canFocus(element))
    ?? home.querySelector<HTMLElement>('[data-hidden-plans] button')
    ?? home;
  heir.focus({ preventScroll: heir === home });
}

/**
 * The corner's press, with somewhere for the keyboard to land. The pressed button leaves with its card,
 * so the heir is chosen BEFORE the press, in the same home: the next corner press in document order,
 * else the previous one, never one inside the card that is leaving (an arc's press takes its plans with
 * it). Both homes draw every card they carry at once, so every heir there will be is already on screen
 * at the press. It is focused on the next frame, once the store's synchronous write has re-rendered the
 * home; a candidate the render took away (the last plan of a deck takes its deck) is skipped, and with
 * none left `landFocusInHome` takes it from there.
 */
export function putAwayKeepingFocus(button: HTMLElement | null, onPress: () => void): void {
  const home = button?.closest<HTMLElement>(LANE_HOME) ?? null;
  const leaving = button?.closest('[data-dispatcher-card], [data-dispatch-arc]') ?? null;
  const presses = home ? [...home.querySelectorAll<HTMLElement>(PUT_AWAY_PRESS)] : [];
  const at = button ? presses.indexOf(button) : -1;
  const heirs = at === -1 ? [] : [...presses.slice(at + 1), ...presses.slice(0, at).reverse()]
    .filter((element) => !leaving?.contains(element) && canFocus(element));
  onPress();
  if (home === null) return;
  requestAnimationFrame(() => landFocusInHome(home, heirs));
}

/**
 * A menu action, with somewhere for the keyboard to land. `Dismiss done plans · N` can empty the menu
 * it sits in, so the whole `ActionMenu` unmounts in the same commit as the press and its own close can
 * only restore focus to a trigger that no longer exists — focus fell to `<body>`. So on the next
 * frame, if the menu is gone, focus goes to this head's own corner press (a menu action never takes
 * its own card), else wherever `landFocusInHome` finds. A menu that survives its action restores focus
 * to its trigger itself, and nothing here moves it.
 */
export function selectKeepingFocus(
  menu: { current: HTMLElement | null },
  press: { current: HTMLElement | null },
  onSelect: () => void,
): void {
  const home = menu.current?.closest<HTMLElement>(LANE_HOME) ?? null;
  onSelect();
  requestAnimationFrame(() => {
    if (menu.current !== null || home === null) return;
    landFocusInHome(home, [press.current]);
  });
}
