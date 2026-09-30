import { PanelBottomOpen, PictureInPicture2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatPlacement } from '@/shared/types';
import { EmptyState } from '@/shared/ui';

type ChatHostPlaceholderProps = {
  /** Which host holds the chat: the floating panel or the picture-in-picture window. Never `'home'`: at home there is no placeholder. */
  placement: Exclude<ChatPlacement, 'home'>;
  /** Brings the chat back to the tab. */
  onBringBack: () => void;
};

/**
 * Used by this module's ChatHostSlot, in the chat tab's place while the chat floats: it says WHICH host holds
 * the chat, and puts the way back under the reader's cursor.
 *
 * The tab is not broken and not empty by accident, and the reader must be able to tell at a glance: a blank
 * tab reads as a crash, and a tab that says only "the chat is elsewhere" leaves them hunting for where. So the
 * icon and the title both name the host (a panel over the workspace, or a window of its own), the line under
 * it says what that means for them, and Bring it back is the one thing to press.
 *
 * It is the kit's EmptyState, composed: the dashed frame says "this space is empty on purpose", which is
 * exactly this. It fills the box it is given (`h-full`) and centres its content; the tab's layout decides the
 * box, so the placeholder never positions itself.
 *
 * THE SLOT MUST GIVE ITS HOME UP WHILE THIS STANDS. ChatHostSlot's home `div` is `h-full` and empty while the
 * chat floats; drawn beside it in the tab's block cell, this placeholder lands entirely below the tab's box
 * (measured: top at 900 in a 900px tab, its button at y 1378) where the tab's `overflow-hidden` clips it, so
 * the reader sees an empty tab with nothing to press. The home gives up its height (`h-0 overflow-hidden`, still
 * rendered rather than `hidden`, so collapse can hand the composer its focus back) for as long as the placeholder is
 * drawn, which is from the moment the chat has left it, and that draws the composition the fixture photographs.
 *
 * The explanation line is the kit's `--ink-faint` at 13.5px, which is 3.1:1 on the light canvas, under AA for
 * small text, and it is the one sentence that says what the empty tab means. The root scopes it to
 * `text-muted-foreground` (`--ink-muted`, about 5:1) for this composition only; EmptyState itself is shared.
 */
export function ChatHostPlaceholder({ placement, onBringBack }: ChatHostPlaceholderProps) {
  const { t } = useTranslation();
  const inWindow = placement === 'window';

  return (
    <div
      data-chat-host-placeholder={placement}
      className="flex h-full min-h-0 w-full items-center justify-center p-6 [&_.vv-empty__message]:text-muted-foreground"
    >
      <EmptyState
        icon={inWindow ? PictureInPicture2 : PanelBottomOpen}
        title={t(inWindow ? 'chatHost.windowTitle' : 'chatHost.panelTitle')}
        message={t(inWindow ? 'chatHost.windowMessage' : 'chatHost.panelMessage')}
        actionLabel={t('chatHost.bringBack')}
        // The caller's collapse: the same way home as the floating header's button.
        onAction={onBringBack}
      />
    </div>
  );
}
