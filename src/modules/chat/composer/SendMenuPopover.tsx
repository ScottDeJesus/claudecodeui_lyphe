import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import { ComposerMenuItem, ComposerMenuSurface } from '@/modules/chat/composer/ComposerMenuPrimitives';

/** What a hold on the send button can choose while a turn is running: wait for the turn to end, or join it. */
export type SendMenuChoice = 'queue' | 'steer';

type SendMenuPopoverProps = {
  /** Open state, owned by the composer: the SEND button is this menu's trigger. */
  isOpen: boolean;
  onClose: () => void;
  /** Reads the send button, so the panel sits above it the way every composer popover does. */
  getTrigger: () => HTMLElement | null;
  onSelect: (choice: SendMenuChoice) => void;
};

/**
 * Rendered by chat's ChatComposer as the panel behind a PRESS-AND-HOLD on the send button while a turn is
 * running and the provider can take a message into it. A tap on that button still queues the message for
 * after the turn, as it always has; the hold offers the other thing the message can do — be read at the
 * agent's next tool call, without the turn stopping.
 *
 * It draws no trigger of its own, for the reason `ScheduleMessagePopover` gives: the footer row is the
 * tightest strip on a phone, and a third control beside the send button would wrap it. Queue is the first
 * row, so a hold that opens the menu by accident can still do the safe thing.
 */
export function SendMenuPopover({ isOpen, onClose, getTrigger, onSelect }: SendMenuPopoverProps) {
  const { t } = useTranslation('chat');
  const hostWindow = useHostWindow();
  // Portalled and anchored like the model and permission menus: the composer sits inside the scrolling
  // transcript's stacking context, so a popover positioned inside it is clipped by the message pane.
  const { menuRef, anchor } = useComposerMenuAnchor(isOpen, onClose, 320, getTrigger);

  if (!isOpen || !anchor) {
    return null;
  }

  const choose = (choice: SendMenuChoice) => {
    onClose();
    onSelect(choice);
  };

  return createPortal(
    <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={t('sendMenu.trigger', { defaultValue: 'Send options' })}>
      <ComposerMenuItem
        isSelected={false}
        role="menuitem"
        label={t('sendMenu.queue.label', { defaultValue: 'Queue' })}
        description={t('sendMenu.queue.descriptionResponding', { defaultValue: 'Send when this turn ends' })}
        onSelect={() => choose('queue')}
      />
      <ComposerMenuItem
        isSelected={false}
        role="menuitem"
        label={t('sendMenu.steer.label', { defaultValue: 'Steer' })}
        description={t('sendMenu.steer.description', { defaultValue: 'Send into this turn; read at the next tool call' })}
        onSelect={() => choose('steer')}
      />
    </ComposerMenuSurface>,
    hostWindow.document.body,
  );
}
