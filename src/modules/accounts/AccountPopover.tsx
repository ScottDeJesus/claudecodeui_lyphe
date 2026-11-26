import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';

import { AccountPanelBody } from '@/modules/accounts/AccountPanelBody';
import { useAccountsContext } from '@/modules/accounts/context/AccountsContext';
import type { AccountSwitcherAnchor } from '@/modules/accounts/context/AccountsContext';
import { accountInUse } from '@/modules/accounts/utils/accountInUseUsage';
import { Button, Card } from '@/shared/ui';
import { OWNS_ESCAPE, overlayInFrontHoldsEscape } from '@/shared/ui/overlayEscape';
import { shouldOutsidePressClose } from '@/shared/utils';

/** The switcher's own id, so what opened it can point at it with `aria-controls`. */
export const ACCOUNT_PANEL_ID = 'account-panel';

/** The air kept between the switcher and the window's edges, in px. */
const EDGE = 8;

/** What a press must land in to count as the switcher's own: the card, a menu it opened (portalled to the body), or whatever opens it. */
const OWN_SURFACE = '[role="menu"], [data-account-ring], [data-account-trigger]';

/**
 * Where a card of `width` by `height` stands beside the point it was opened from, in a window of `windowWidth` by `windowHeight`.
 *
 * Over or under the point first, centred on it and clear of it: over it when the point is in the window's lower half and there is
 * room, else under it when there is room there. When neither has room (a tall card opened from a core at the window's foot), or the
 * opener asks for it (`beside`, the rail's button), it stands to the side that has room, level with the point. With no room on any
 * side (a phone) it takes the window, over what opened it. Whatever it chose, it is pushed back inside the window at every edge.
 */
function placeBeside(anchor: AccountSwitcherAnchor, width: number, height: number, windowWidth: number, windowHeight: number): { left: number; top: number } {
  const insideX = (left: number) => Math.round(Math.min(Math.max(EDGE, left), Math.max(EDGE, windowWidth - width - EDGE)));
  const insideY = (top: number) => Math.round(Math.min(Math.max(EDGE, top), Math.max(EDGE, windowHeight - height - EDGE)));
  const over = anchor.y - anchor.clear - height;
  const under = anchor.y + anchor.clear;
  const roomOver = over >= EDGE;
  const roomUnder = under + height <= windowHeight - EDGE;
  const lower = anchor.y > windowHeight / 2;
  if (anchor.beside !== true && (roomOver || roomUnder)) {
    return { left: insideX(anchor.x - width / 2), top: insideY((lower && roomOver) || !roomUnder ? over : under) };
  }
  const after = anchor.x + anchor.clear;
  const before = anchor.x - anchor.clear - width;
  const roomAfter = after + width <= windowWidth - EDGE;
  const roomBefore = before >= EDGE;
  if (roomAfter || roomBefore) {
    return { left: insideX(roomAfter && (!roomBefore || windowWidth - after >= anchor.x) ? after : before), top: insideY(anchor.y - height / 2) };
  }
  return { left: insideX(anchor.x - width / 2), top: insideY(lower ? over : under) };
}

/**
 * THE ACCOUNT SWITCHER: one card, opened from an account ring or the rail's account button, holding `AccountPanelBody` under the name of
 * the account in use. Used by this module's `AccountSwitcher`, the one place it is mounted.
 *
 * WHERE IT STANDS. Beside the point it was opened from (`anchor`), clear of the ring or button that was pressed wherever the window has
 * the room (`placeBeside`). Its place is measured from its own box, so a body that grows (a refusal, a third dial) moves it rather than
 * running off the window. Taller than the window, it scrolls from a top edge the reader can see.
 *
 * HOW IT SHUTS. Its back arrow, Escape, a press anywhere outside it, or a second press on what opened it. Escape is taken on the
 * window's capture phase and marked handled, so the page's own Escape (the way back, `useEscapeBack`) stands down for it;
 * the card states it owns the key (`OWNS_ESCAPE`), so the page under it stands down, and it stands down itself for a menu it opened.
 * While a sign-in window is up neither shuts it: that window is drawn outside this card, so every press in it would read as outside.
 *
 * It composes Card rather than the library's Menu: a Menu is a list of labelled choices, and this carries dials, rings and buttons.
 */
export function AccountPopover({ anchor }: { anchor: AccountSwitcherAnchor }) {
  const { accounts, signInOpen, closeSwitcher } = useAccountsContext();
  const cardRef = useRef<HTMLDivElement>(null);
  // Where the card's top left corner stands in the window, or null before its box has been measured (it is drawn hidden until then).
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    const settle = () => {
      const { width, height } = card.getBoundingClientRect();
      const { left, top } = placeBeside(anchor, width, height, window.innerWidth, window.innerHeight);
      setPlace((current) => (current !== null && current.left === left && current.top === top ? current : { left, top }));
    };
    settle();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(settle);
    observer?.observe(card);
    window.addEventListener('resize', settle);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', settle);
    };
  }, [anchor]);

  useEffect(() => {
    if (signInOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target === null || target.closest(OWN_SURFACE) || !shouldOutsidePressClose(event, [cardRef.current])) return;
      closeSwitcher();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || overlayInFrontHoldsEscape(cardRef.current, document)) return;
      event.preventDefault();
      closeSwitcher();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape, { capture: true });
    };
  }, [signInOpen, closeSwitcher]);

  // The focus goes into the card as it opens, and back to what held it when the card shuts with the focus still inside.
  useEffect(() => {
    const card = cardRef.current;
    const held = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    card?.focus({ preventScroll: true });
    return () => {
      if (card !== null && (card.contains(document.activeElement) || document.activeElement === document.body)) held?.focus({ preventScroll: true });
    };
  }, []);

  const inUse = accountInUse(accounts);
  const name = inUse?.email ?? inUse?.slug ?? '—';

  return createPortal(
    <Card
      ref={cardRef}
      id={ACCOUNT_PANEL_ID}
      role="dialog"
      aria-label="Account and usage"
      tabIndex={-1}
      {...OWNS_ESCAPE}
      className="fixed z-[60] flex max-h-[calc(100dvh-1rem)] w-80 max-w-[calc(100vw-1rem)] flex-col gap-4 overflow-y-auto overscroll-contain p-3 shadow-[var(--shadow-overlay)] outline-none"
      style={place === null ? { left: 0, top: 0, visibility: 'hidden' } : place}
    >
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8 flex-none finger:h-11 finger:w-11" aria-label="Close" onClick={closeSwitcher}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase leading-tight tracking-[0.14em] text-ink-faint">Account</div>
          <div className="break-all text-sm font-medium leading-snug text-foreground">{name}</div>
        </div>
      </div>
      <AccountPanelBody />
    </Card>,
    document.body,
  );
}

/**
 * The account switcher's one mount: it draws the switcher while the provider says it is open, and nothing otherwise. Used by the
 * project-workspace module's `ProjectWorkspaceShell`, through the accounts barrel, inside `AccountsProvider` beside the pages whose
 * rings open it.
 */
export function AccountSwitcher() {
  const { switcher } = useAccountsContext();
  return switcher === null ? null : <AccountPopover anchor={switcher} />;
}
