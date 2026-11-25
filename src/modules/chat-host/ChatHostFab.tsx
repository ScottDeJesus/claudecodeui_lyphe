import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatHost, useChatHostMechanics } from '@/modules/chat-host/context/ChatHostContext';
import { DockableFab } from '@/shared/ui';
import type { DockableFabPosition } from '@/shared/ui';

type ChatHostFabProps = {
  /** Where the button stands: the reader's stored point, or the kit's resting corner. */
  position: DockableFabPosition;
  /** Once, as a gesture on the button becomes a drag. */
  onDragStart: () => void;
  /** Once per drag, at its release. */
  onPositionChange: (next: DockableFabPosition) => void;
};

/**
 * THE FLOATING CHAT'S BUTTON: the chat's own core, live, on the kit's floating button. Used by this module's `ChatHostFloating`,
 * beside the panel and for exactly as long as the chat floats in it.
 *
 * WHAT IT DRAWS is not this file's: the element in its middle is handed to the chat (`setButtonPlace`), and the chat's core draws
 * itself there, so the button says what the chat is doing without a word. The kit's dot on its rim is the unread rule's: a reply
 * that landed while the panel was folded.
 *
 * ITS PRESS folds the panel down to this button and brings it back; the chat keeps floating either way. ITS DRAG is the kit's, and
 * it is the same move as a drag of the panel's header: the panel follows the rect this button reports (`reportAnchor`).
 *
 * 44px, not the kit's 28: at 28 the core's form cannot be told apart, and 44 is the kit's own catch, so the button is as large to
 * look at as it always was to hit. The drawing's element lets no pointer through: the chat's portal lands in the chat's own React
 * tree, and a press that reached it would never reach this button's handlers.
 *
 * IT STANDS AT 46, NOT THE KIT'S 60: one step over the panel (45), so the way to fold the chat is never under the panel, and
 * under the layer that portals to `body` at 50 (dialogs, menus, the command palette). The floating chat is mounted at the root,
 * beside the shell, where the kit's 60 would put this button over an open modal and let a press through to it. It is clear: no fill and no ring, at rest, on hover or while open, because the core is the button's whole face and brings its own colour.
 */
export function ChatHostFab({ position, onDragStart, onPositionChange }: ChatHostFabProps) {
  const { t } = useTranslation();
  const { folded, unread, toggleFold, reportAnchor } = useChatHost();
  const { setButtonPlace } = useChatHostMechanics();

  // A button that goes takes its rect with it, so a panel never stands beside where a button used to be.
  useEffect(() => () => reportAnchor(null), [reportAnchor]);

  return (
    <div data-chat-host-fab={folded ? 'folded' : 'open'} className="contents [&_.vv-fab]:z-[46] [&_.vv-fab]:[--vv-fab-size:44px] [&_.vv-fab]:bg-transparent [&_.vv-fab:hover]:bg-transparent [&_.vv-fab]:shadow-none [&_.vv-fab:hover]:shadow-none [&_.vv-fab]:text-foreground">
      <DockableFab
        label={folded
          ? t('chatHost.unfold', { defaultValue: 'Bring the chat back' })
          : t('chatHost.fold', { defaultValue: 'Fold the chat down to its core' })}
        icon={<span ref={setButtonPlace} data-chat-host-core="" className="pointer-events-none absolute inset-0 grid place-items-center" />}
        position={position}
        dockRect={null}
        active={!folded}
        indicator={unread}
        onPress={toggleFold}
        onDragStart={onDragStart}
        onPositionChange={onPositionChange}
        onRectChange={reportAnchor}
      />
    </div>
  );
}
