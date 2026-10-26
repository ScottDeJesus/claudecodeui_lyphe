import { AccountPanelBody } from '@/modules/accounts/AccountPanelBody';
import { Card } from '@/shared/ui';

/** The panel's own id, so the trigger can point at it with `aria-controls`. */
export const ACCOUNT_PANEL_ID = 'account-panel';

/**
 * The account panel's popover: the card that stands beside the views rail with `AccountPanelBody` in it. Used by the
 * accounts module's AccountRailButton, which owns the open state and mounts this on the foot of the rail's account button.
 *
 * It holds the chrome and nothing else — its position, its size caps, its dialog role. What it shows is the body, which
 * reads the provider's state (`AccountsProvider`) and is the same body the Accounts gutter widget draws.
 *
 * It composes Card rather than adopting the library's Menu: a Menu is a list of labelled choices, and this panel carries
 * meters, avatars and buttons.
 */
export function AccountPopover() {
  return (
    // Beside the rail, level with the foot of the button it hangs from, and growing upward from there. The rail is
    // 48px wide and the panel 17.5rem, capped at the viewport less the rail's width and a margin so a phone's
    // narrow screen keeps its right edge. The height cap is the viewport less the button's own distance from the
    // foot and the safe-area insets: a cap taller than the room above the button pushes the top edge off screen and
    // the first meter loses its label. Past the cap the panel scrolls from a top edge the reader can see.
    <Card
      id={ACCOUNT_PANEL_ID}
      role="dialog"
      aria-label="Account and usage"
      className="absolute bottom-0 left-full z-50 ml-2 flex max-h-[calc(100dvh-1rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] w-[17.5rem] max-w-[calc(100vw-4rem)] flex-col gap-3 overflow-y-auto p-3"
    >
      <AccountPanelBody />
    </Card>
  );
}
