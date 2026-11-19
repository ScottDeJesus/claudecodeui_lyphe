import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { KanbanBoardRepos } from '@/modules/kanban/KanbanBoardRepos';
import { withTypedRepo } from '@/modules/kanban/utils/boardRepos';
import { Banner, Button, Dialog, DialogContent, Field, Input } from '@/shared/ui';

/**
 * The board's own surface: New board, Rename, Repositories, and the Archive confirm.
 *
 * ONE SURFACE, FOUR ROWS, because they are the same two decisions and one question: what is this
 * board CALLED, where are its cards BUILT, and — for archive — do you mean it. A new board is
 * asked both, since a board made to run itself needs both before its switch will turn; the two
 * rows of the `…` each ask one, so a rename never shows a list of paths and the repositories never
 * show a name field nobody came to change.
 *
 * STATELESS APART FROM THE DRAFT. The panel owns which row was pressed and what the answer means;
 * this file owns the box, the drafted name and list, and the two ways out — Escape and the
 * backdrop, both of which close without writing anything.
 *
 * SAVE SAVES WHAT IS ON SCREEN, THE PATH STILL IN THE FIELD INCLUDED. Typing a path and pressing
 * the primary button is the shortest way through this box, so a typed path is taken into the list
 * by Save exactly as Add would have taken it. That is why the typed text is held here and not in
 * the field's own file: a draft the Save press cannot see is a repository silently left behind,
 * and on a new board a board that then refuses its own switch.
 *
 * WHY IT OPENED AND WHY IT WAS REFUSED ARE BOTH SAID HERE, in the server's words. A board whose
 * Autonomy switch was refused for naming no repository opens on Repositories with that sentence
 * above the list (`notice`): the fix is under the reader's hand, not in a toast that has left. A
 * list the server will not take (`refusal`) is said under the field, and the box stays open over
 * the reader's draft, which is the only state they can correct it from.
 *
 * ARCHIVING IS ANNOUNCED AS A HIDING, NOT A DELETION, because that is what it is: the board leaves
 * the switcher and every card on it stays exactly where it was. The button is `destructive` for
 * the one thing it does do — it takes the whole board out of sight at once.
 */

export type KanbanBoardDialogMode = 'new' | 'rename' | 'repos' | 'archive' | null;

/** What the reader drafted. A row that does not ask for a field hands back what it was seeded with. */
export type KanbanBoardDraft = { name: string; repos: string[] };

type KanbanBoardDialogProps = {
  /** `null` is a closed surface. The panel sets it from the header's rows. */
  mode: KanbanBoardDialogMode;
  /** The board's own name for a rename, empty for a new board. */
  initialName: string;
  /** The board's own repositories, empty for a new board. */
  initialRepos: string[];
  /** The projects a repository is picked from. */
  projects: Array<{ name: string; path: string }>;
  /** Why the surface opened by itself, in the server's words, or `null` when a row opened it. */
  notice: string | null;
  /** The server's sentence when it refused the repositories, or `null`. */
  refusal: string | null;
  onClose: () => void;
  onConfirm: (draft: KanbanBoardDraft) => void;
};

/** Rendered by KanbanPanel. Nothing else mounts it, and it holds no board state of its own. */
export function KanbanBoardDialog({
  mode,
  initialName,
  initialRepos,
  projects,
  notice,
  refusal,
  onClose,
  onConfirm,
}: KanbanBoardDialogProps) {
  const { t } = useTranslation();
  // Seeded ONCE, from a fresh mount: the panel gives this surface a `key` per opening, so a rename
  // that opens carrying the name of whatever board was renamed last cannot happen — which is why
  // there is no effect here re-seeding the fields when the surface changes.
  const [name, setName] = useState(initialName);
  const [repos, setRepos] = useState(initialRepos);
  const [typedRepo, setTypedRepo] = useState('');
  const fieldId = useId();
  const titleId = useId();

  const trimmed = name.trim();
  const archiving = mode === 'archive';
  const asksName = mode === 'new' || mode === 'rename';
  const asksRepos = mode === 'new' || mode === 'repos';
  const title = archiving
    ? t('kanban.board.archiveTitle')
    : mode === 'rename'
      ? t('kanban.board.renameTitle')
      : mode === 'repos'
        ? t('kanban.board.reposTitle')
        : t('kanban.board.newTitle');

  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-labelledby={titleId} className="flex max-h-[90vh] flex-col gap-4 overflow-y-auto p-5">
        <h2 id={titleId} className="text-base font-medium text-foreground">{title}</h2>

        {notice !== null && <Banner tone="warn">{notice}</Banner>}

        {archiving && <p className="text-sm text-muted-foreground">{t('kanban.board.archiveMessage')}</p>}

        {asksName && (
          <Field label={t('kanban.board.nameLabel')} htmlFor={fieldId}>
            <Input
              id={fieldId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('kanban.board.namePlaceholder')}
            />
          </Field>
        )}

        {asksRepos && (
          <KanbanBoardRepos
            repos={repos}
            projects={projects}
            onChange={setRepos}
            typed={typedRepo}
            onTypedChange={setTypedRepo}
            refusal={refusal}
          />
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" className="finger:h-11" onClick={onClose}>{t('kanban.board.cancel')}</Button>
          <Button
            variant={archiving ? 'destructive' : 'default'}
            className="finger:h-11"
            // An empty name is refused by the server too; refusing it here is the same verdict one
            // round trip earlier, and the disabled button is where the reader is already looking.
            disabled={asksName && trimmed.length === 0}
            onClick={() => {
              // The path still in the field joins the list first, on screen and in what is saved:
              // a box that stays open over a refusal then shows the refused path as a row.
              const drafted = asksRepos ? withTypedRepo(repos, typedRepo) : repos;
              setRepos(drafted);
              setTypedRepo('');
              onConfirm({ name: trimmed, repos: drafted });
            }}
          >
            {archiving ? t('kanban.board.archive') : t('kanban.board.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
