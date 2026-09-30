import { Folder, FolderInput } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { SimpleListFolder } from '@/shared/types';

// File-local: read only by SidebarSimpleList, which owns the chat whose picker is open and the pick
// handler this dialog is bound to.
type SidebarSimpleFolderPickerProps = {
  open: boolean;
  /** Every folder the list has loaded, in drawn order. */
  folders: SimpleListFolder[];
  /** The folder the chat sits in now; null for a chat in none. */
  currentFolderId: string | null;
  onPick: (folderId: string | null) => void;
  onCancel: () => void;
  t: TFunction;
};

/**
 * The folder list a chat's "Move to folder…" opens: one ghost row per folder, the folder the chat is
 * in now pressed and disabled, and — only for a chat that is in one — a last row that takes it back
 * out. Shaped like the icon picker beside it, because it is the same question asked twice.
 *
 * THE ROWS ARE WORDS, NOT A TREE: a folder's own chats are not drawn here and nothing here can nest,
 * so the list stays one decision long however many folders there are.
 *
 * THE CURRENT FOLDER IS DISABLED, NOT MERELY PRESSED. Pressing it would ask the server for the move
 * the chat already sits in, and a control that answers "nothing happened" is a control that reads
 * as broken.
 *
 * Used by SidebarSimpleList.
 */
export default function SidebarSimpleFolderPicker({
  open,
  folders,
  currentFolderId,
  onPick,
  onCancel,
  t,
}: SidebarSimpleFolderPickerProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent
        data-testid="simple-chat-folder-dialog"
        className="w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-border bg-popover p-5 shadow-2xl"
      >
        <DialogTitle>{t('simpleList.folderPickerTitle')}</DialogTitle>
        <p className="text-sm font-medium text-foreground">{t('simpleList.folderPickerTitle')}</p>
        <div className="mt-3 flex flex-col gap-1">
          {folders.map((folder) => {
            const isCurrent = folder.folderId === currentFolderId;
            return (
              <Button
                key={folder.folderId}
                data-testid="simple-chat-folder-option"
                data-folder-id={folder.folderId}
                variant="ghost"
                disabled={isCurrent}
                aria-pressed={isCurrent}
                className={cn(
                  'w-full justify-start',
                  isCurrent ? 'text-foreground ring-2 ring-primary' : 'text-muted-foreground hover:text-foreground',
                )}
                // FILL: onPick
                onClick={() => onPick(folder.folderId)}
              >
                <Folder className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{folder.name}</span>
              </Button>
            );
          })}

          {/* Only for a chat that is IN a folder: a chat in none has nothing to come out of. */}
          {currentFolderId !== null && (
            <Button
              data-testid="simple-chat-folder-option"
              data-folder-id="none"
              variant="ghost"
              aria-pressed={false}
              className="w-full justify-start text-muted-foreground hover:text-foreground"
              // FILL: onPick
              onClick={() => onPick(null)}
            >
              <FolderInput className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span className="truncate">{t('simpleList.noFolder')}</span>
            </Button>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          {/* FILL: onCancel */}
          <Button data-testid="simple-chat-folder-cancel" variant="ghost" size="sm" onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
