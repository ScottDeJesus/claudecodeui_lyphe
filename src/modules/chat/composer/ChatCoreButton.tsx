import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { FAB_SIZE_PX } from '@/shared/constants';
import { useChatCoreButton } from '@/shared/context/ChatCoreButtonContext';
import { useCoreDrawing } from '@/shared/context/CoreDrawingContext';
import type { CoreDrawingInput } from '@/shared/context/CoreDrawingContext';
import { SignalLoop } from '@/shared/ui';

type ChatCoreButtonProps = {
  /** What the chat is doing, by the core's own word: read by a script off `data-chat-core-button`. */
  doing: string;
  /** Whether the chat is at rest or waiting on the reader, for the loop that stands in where no page gave the instrument. */
  resting: boolean;
  /** Everything the core beside the line is drawn from, but its size: the button gives that. */
  drawing: Omit<CoreDrawingInput, 'size'>;
};

/**
 * THE CHAT'S CORE ON THE FLOATING CHAT'S BUTTON: the same instrument as the core beside the line, from the same reading, drawn at
 * the button's own size into the element the host gave (`useChatCoreButton`). So a chat floating over another screen, or folded down
 * to its button, still says what it is doing: its form while a turn runs, the dish turned to the reader while it waits on them.
 *
 * It draws and nothing else. The press, the drag and the unread dot are the button's (chat-host's `ChatHostFab`), whose element lets
 * no pointer through to this drawing. The size is measured off that element, so the kit may give the button any size. Renders
 * nothing while no button stands. Used by `ChatCore`.
 */
export function ChatCoreButton({ doing, resting, drawing }: ChatCoreButtonProps) {
  const place = useChatCoreButton();
  const draw = useCoreDrawing();
  // The button's side in px. State because the drawing is sized by it and the kit may ease the button's size; measured, never assumed.
  const [side, setSide] = useState(FAB_SIZE_PX);
  useLayoutEffect(() => {
    if (place === null) return undefined;
    const measure = () => {
      const next = Math.round(place.getBoundingClientRect().width);
      if (next > 0) setSide((current) => (current === next ? current : next));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(place);
    return () => observer?.disconnect();
  }, [place]);

  if (place === null) return null;
  return createPortal(
    <span data-chat-core-button={doing} className="grid place-items-center" style={{ width: side, height: side }}>
      {draw !== null ? draw({ ...drawing, size: side }) : <SignalLoop state={resting ? 'idle' : 'thinking'} size={side} />}
    </span>,
    place,
  );
}
