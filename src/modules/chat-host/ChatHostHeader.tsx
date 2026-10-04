import type { ReactNode } from 'react';
import { Minimize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Tooltip } from '@/shared/ui';

type ChatHostHeaderProps = {
  /** The conversation part, filled by project-workspace: the picker that names the open conversation. It takes every pixel the collapse control leaves. */
  header: ReactNode;
  /** Brings the chat home. */
  onCollapse: () => void;
};

/**
 * Used by this module's ChatHostFloating for the panel's top and by ChatHostWindow for the picture-in-picture
 * window's top: the thin frame both floating hosts share, so the chat is headed the same way wherever it floats.
 *
 * ONE ROW, 40px, IN THIS ORDER: the conversation, then the way home. What the reader needs first is which
 * conversation this is and how to switch it, so the `header` slot takes the row's width from its left edge; the
 * collapse control is the one fixed thing at the far end, where the eye goes to leave. Nothing else lives here:
 * a title bar that carries more is a second toolbar over the composer the reader came to use.
 *
 * THE SLOT IS CLIPPED ON ITS OWN AXIS (`overflow-x-clip`), so a slot that does not truncate itself runs out of
 * sight at the collapse control and never across it; the frame that holds the way home is this file's job, not
 * the picker's. The clip would cut a focus ring at the slot's edges, so the slot keeps a 4px lane there (`-mx-1
 * px-1`): the house ring is 2px wide and 2px off the control, and a picker's keeps to that lane whole.
 *
 * 40px because it must fit two hosts. The panel can be resized down to 376px and the window opens at 420px, and
 * at either width a 32px icon button and a truncating picker still leave the conversation's name readable. The
 * button is 32px to look at and 40px to hit (a transparent `before` catch, the FAB's own trick), so a finger on
 * the phone's panel does not have to aim.
 *
 * THE PANEL'S GRIP CLEARANCE arrives as two inherited custom properties, `--chat-host-header-left` and
 * `--chat-host-header-right`, that ChatHostPanel sets on its frame when its resize grip stands in a TOP corner
 * (the grip is drawn over the header there, and a picker or a collapse button under it could not be pressed).
 * Custom properties inherit, so the header takes the room without knowing why, and the window — which sets
 * neither — gets the fallbacks below. It is the tone swap's shape (tokens.css) applied to spacing.
 */
export function ChatHostHeader({ header, onCollapse }: ChatHostHeaderProps) {
  const { t } = useTranslation();

  return (
    <div
      data-chat-host-header=""
      className="flex h-10 min-w-0 shrink-0 items-center gap-1 border-b border-border bg-card"
      style={{
        paddingLeft: 'var(--chat-host-header-left, 0.5rem)',
        paddingRight: 'var(--chat-host-header-right, 0.375rem)',
      }}
    >
      <div className="-mx-1 flex min-w-0 flex-1 items-center overflow-x-clip px-1">{header}</div>
      <Tooltip content={t('chatHost.collapse')} position="bottom">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('chatHost.collapse')}
          className="relative h-8 w-8 shrink-0 text-muted-foreground before:absolute before:-inset-1 before:content-[''] hover:text-foreground"
          // The caller's collapse: from the panel it carries the chat home before the panel goes down.
          onClick={onCollapse}
        >
          <Minimize2 aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  );
}
