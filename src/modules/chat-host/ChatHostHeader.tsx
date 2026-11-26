import type { HTMLAttributes, ReactNode } from 'react';
import { Minimize2, PictureInPicture2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

type ChatHostHeaderProps = {
  /** The conversation part, filled by project-workspace: the picker that names the open conversation. It takes every pixel the controls leave. */
  header: ReactNode;
  /** Brings the chat home. */
  onCollapse: () => void;
  /** Carries the chat out to a window of its own, the one host that can stand over another application. Absent where there is none to offer: the window's own header, a browser without one. */
  onPopOut?: () => void;
  /** The panel's move, worn by the whole row: a drag begun anywhere on it but its controls carries the panel and its button. Absent in the window, which the reader's own desktop moves. */
  moveHandle?: Pick<HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onClickCapture'>;
};

/**
 * Used by this module's ChatHostFloating for the panel's top and by ChatHostWindow for the picture-in-picture
 * window's top: the thin frame both floating hosts share, so the chat is headed the same way wherever it floats.
 *
 * ONE ROW, 40px, IN THIS ORDER: the conversation, then the ways out. What the reader needs first is which
 * conversation this is and how to switch it, so the `header` slot takes the row's width from its left edge; the
 * controls are the fixed things at the far end, where the eye goes to leave: out to a window of its own (the panel
 * alone, where the browser offers one), then home, last, where it always was. Nothing else lives here: a title bar
 * that carries more is a second toolbar over the composer the reader came to use.
 *
 * IN THE PANEL THE ROW IS ALSO THE HANDLE (`moveHandle`): a drag begun anywhere on it but the controls moves the panel,
 * as a window's title bar does, and the cursor says so. `touch-none` keeps a finger's drag from becoming a scroll of
 * the page under the panel. A press that does not move is still a press on whatever it landed on.
 *
 * THE SLOT IS CLIPPED ON ITS OWN AXIS (`overflow-x-clip`), so a slot that does not truncate itself runs out of
 * sight at the controls and never across them; the frame that holds the ways out is this file's job, not
 * the picker's. The clip would cut a focus ring at the slot's edges, so the slot keeps a 4px lane there (`-mx-1
 * px-1`): the house ring is 2px wide and 2px off the control, and a picker's keeps to that lane whole.
 *
 * 40px because it must fit two hosts. The panel can be resized down to 376px and the window opens at 420px, and
 * at either width two 32px icon buttons and a truncating picker still leave the conversation's name readable. Each
 * button is 32px to look at and 40px to hit (a transparent `before` catch, the FAB's own trick), so a finger on
 * the phone's panel does not have to aim.
 *
 * THE PANEL'S GRIP CLEARANCE arrives as two inherited custom properties, `--chat-host-header-left` and
 * `--chat-host-header-right`, that ChatHostPanel sets on its frame when its resize grip stands in a TOP corner
 * (the grip is drawn over the header there, and a picker or a control under it could not be pressed).
 * Custom properties inherit, so the header takes the room without knowing why, and the window — which sets
 * neither — gets the fallbacks below. It is the tone swap's shape (tokens.css) applied to spacing.
 */
export function ChatHostHeader({ header, onCollapse, onPopOut, moveHandle }: ChatHostHeaderProps) {
  const { t } = useTranslation();

  return (
    <div
      data-chat-host-header=""
      className={cn(
        'flex h-10 min-w-0 shrink-0 items-center gap-1 border-b border-border bg-card',
        moveHandle && 'cursor-grab touch-none select-none',
      )}
      style={{
        paddingLeft: 'var(--chat-host-header-left, 0.5rem)',
        paddingRight: 'var(--chat-host-header-right, 0.375rem)',
      }}
      {...moveHandle}
    >
      <div className="-mx-1 flex min-w-0 flex-1 items-center overflow-x-clip px-1">{header}</div>
      <div data-chat-host-acts="" className="flex shrink-0 items-center gap-1">
        {onPopOut && (
          <Tooltip content={t('chatHost.popOut', { defaultValue: 'Pop out to its own window' })} position="bottom">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('chatHost.popOut', { defaultValue: 'Pop out to its own window' })}
              className="relative h-8 w-8 shrink-0 text-muted-foreground before:absolute before:-inset-1 before:content-[''] hover:text-foreground"
              // Inside the press: the window's request spends this press's activation.
              onClick={onPopOut}
            >
              <PictureInPicture2 aria-hidden="true" />
            </Button>
          </Tooltip>
        )}
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
    </div>
  );
}
