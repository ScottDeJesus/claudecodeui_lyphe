import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Dialog, DialogContent, Field, Input } from '@/shared/ui';

/**
 * The board's own name surface: New board, Rename, and the Archive confirm.
 *
 * ONE SURFACE, THREE ROWS, because they are the same decision twice over and one question the
 * third time: what is this board CALLED, and — for archive — do you mean it. A `window.prompt`
 * would do the same job with none of the field, none of the focus trap and none of the app's own
 * name for a label, which is why the two name rows open this instead.
 *
 * STATELESS APART FROM THE FIELD ITSELF. The panel owns which row was pressed and what the
 * answer means; this file owns the box, the draft, and the two ways out — Escape and the backdrop,
 * both of which close without writing anything.
 *
 * ARCHIVING IS ANNOUNCED AS A HIDING, NOT A DELETION, because that is what it is: the board leaves
 * the switcher and every card on it stays exactly where it was. The button is `destructive` for
 * the one thing it does do — it takes the whole board out of sight at once.
 */

export type KanbanBoardDialogMode = 'new' | 'rename' | 'archive' | null;

type KanbanBoardDialogProps = {
  /** `null` is a closed surface. The panel sets it from the header's three rows. */
  mode: KanbanBoardDialogMode;
  /** The board's own name for a rename, empty for a new board. */
  initialName: string;
  onClose: () => void;
  /** The board's name — meaningless for archive, which writes nothing but the archive flag. */
  onConfirm: (name: string) => void;
};

/** Rendered by KanbanPanel. Nothing else mounts it, and it holds no board state of its own. */
export function KanbanBoardDialog({ mode, initialName, onClose, onConfirm }: KanbanBoardDialogProps) {
  const { t } = useTranslation();
  // Seeded ONCE, from a fresh mount: the panel gives this surface a `key` per opening, so a rename
  // that opens carrying the name of whatever board was renamed last cannot happen — which is why
  // there is no effect here re-seeding the field when the surface changes.
  const [name, setName] = useState(initialName);
  const fieldId = useId();
  const titleId = useId();

  const trimmed = name.trim();
  const archiving = mode === 'archive';
  const title = archiving
    ? t('kanban.board.archiveTitle')
    : mode === 'rename'
      ? t('kanban.board.renameTitle')
      : t('kanban.board.newTitle');

  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-labelledby={titleId} className="flex flex-col gap-4 p-5">
        <h2 id={titleId} className="text-base font-medium text-foreground">{title}</h2>

        {archiving ? (
          <p className="text-sm text-muted-foreground">{t('kanban.board.archiveMessage')}</p>
        ) : (
          <Field label={t('kanban.board.nameLabel')} htmlFor={fieldId}>
            <Input
              id={fieldId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('kanban.board.namePlaceholder')}
            />
          </Field>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('kanban.board.cancel')}</Button>
          <Button
            variant={archiving ? 'destructive' : 'default'}
            // An empty name is refused by the server too; refusing it here is the same verdict one
            // round trip earlier, and the disabled button is where the reader is already looking.
            disabled={!archiving && trimmed.length === 0}
            onClick={() => onConfirm(trimmed)}
          >
            {archiving ? t('kanban.board.archive') : t('kanban.board.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
