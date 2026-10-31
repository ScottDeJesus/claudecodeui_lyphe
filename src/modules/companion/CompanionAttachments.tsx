import { ChatMessageFiles, ChatMessageImages } from '@/modules/chat';
import type { CompanionAttachment } from '@/shared/companion-types';
import { isImageAttachment } from '@/shared/utils';

type CompanionAttachmentsProps = {
  /** The files he attached to one typed line, in the order he attached them. */
  attachments: CompanionAttachment[];
  /**
   * `message`: the chat's own size, his turn's squares and cards in rows that wrap (her log, above his words). `small`: the chat's
   * 28 px squares and pills, all on one line (her portrait's strip).
   */
  size: 'message' | 'small';
};

/**
 * His line's attachments, split by `isImageAttachment`: the chat's `ChatMessageImages` then `ChatMessageFiles`, right-aligned, at the
 * chat's size (`message`) or `small`. Nothing when there are none. The chat module is the one home of how an attachment looks; this
 * only splits his records into the chat's two views, whose presses are their own: a picture enlarges in the lightbox, a file
 * downloads. Drawn by this module's `CompanionLog` (his row, under his caption, at `message`, capped at his bubble's 85%) and
 * `CompanionAttachmentStrip` (at `small`).
 */
export function CompanionAttachments({ attachments, size }: CompanionAttachmentsProps) {
  if (attachments.length === 0) return null;
  const pictures = attachments.filter(isImageAttachment);
  const files = attachments.filter((attachment) => !isImageAttachment(attachment));
  const viewSize = size === 'message' ? 'default' : 'small';

  return (
    <div
      data-companion-attachments={size}
      // `message` stacks the chat's two rows, as his turn in a chat stacks them; `small` keeps both on one line, the gap growing to
      // 16 px under a finger with the views' own, so no two 44 px catches meet.
      className={size === 'message' ? 'flex max-w-[85%] flex-col items-end gap-2' : 'flex items-center justify-end gap-1.5 finger:gap-4'}
    >
      <ChatMessageImages images={pictures} size={viewSize} />
      <ChatMessageFiles files={files} size={viewSize} />
    </div>
  );
}
