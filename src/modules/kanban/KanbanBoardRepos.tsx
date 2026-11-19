import { X } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { withTypedRepo } from '@/modules/kanban/utils/boardRepos';
import { Badge, Button, Field, Input, Select } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * WHERE A BOARD'S CARDS ARE BUILT: the git repositories a self-running board names, as a list a
 * reader adds to by picking a project or typing a path, and takes from with one press.
 *
 * THE LIST IS THE ANSWER AND IT IS FIRST. What a reader opens this for is "which repositories does
 * this board touch", so the paths stand above the two ways to add one. Each is drawn whole, in the
 * mono face, breaking wherever it must: a path cut with an ellipsis is two repositories that look
 * alike.
 *
 * ORDER IS MEANING, AND IT SAYS SO. A card's walk starts in the first repository and is given the
 * rest beside it, so the first row wears "Starts here" once there is a second to tell it from.
 *
 * TWO WAYS IN, ONE LIST. Picking a project adds it at once — the pick IS the decision, and a
 * second press to confirm it would be a press that decides nothing. A typed path joins the list on
 * Add or Enter — and on the dialog's Save, which is why the typed text is the DIALOG's and not this
 * file's: a path typed and saved without Add is a path the reader meant, and a draft held here
 * would be dropped without a word. Whether a path is a directory inside a git work tree is the
 * SERVER's to say; its refusal comes back as `refusal` and is drawn under the field in its own
 * words, and the row it names wears the mark — the refused path is in the list by then, not in
 * the field.
 *
 * NO REPOSITORY IS A STATE WITH A CONSEQUENCE, so the empty list says what it costs: the board
 * cannot run itself until it names one.
 *
 * It holds nothing. The list and the typed path are the dialog's, which decides when to save.
 */

type KanbanBoardReposProps = {
  /** The repositories as drafted, in order. Absolute paths. */
  repos: string[];
  /** The projects the app knows, each a name and the absolute path it stands for. */
  projects: Array<{ name: string; path: string }>;
  onChange: (repos: string[]) => void;
  /** The path being typed, not yet on the list. The dialog's, so its Save can take it in. */
  typed: string;
  onTypedChange: (typed: string) => void;
  /** The server's sentence when it refused the list, or `null`. */
  refusal: string | null;
};

/** Rendered by KanbanBoardDialog, for a new board and for a board's Repositories row. */
export function KanbanBoardRepos({ repos, projects, onChange, typed, onTypedChange, refusal }: KanbanBoardReposProps) {
  const { t } = useTranslation();
  const inputId = useId();

  const add = (path: string) => onChange(withTypedRepo(repos, path));

  const addTyped = () => {
    add(typed);
    onTypedChange('');
  };

  // The row a refusal names: the server's sentence quotes the path it would not take. The longest
  // listed path it holds, because one repository's path is often the start of another's.
  const refused = refusal === null
    ? null
    : (repos.filter((path) => refusal.includes(path)).sort((left, right) => right.length - left.length)[0] ?? null);

  // A project already on the list is not offered again: picking it would add nothing.
  const offered = projects
    .filter((project) => !repos.includes(project.path))
    .map((project) => ({ value: project.path, label: project.name }));

  return (
    <div className="flex flex-col gap-3" data-board-repos>
      <Field
        label={t('kanban.repos.label')}
        htmlFor={inputId}
        helper={t('kanban.repos.helper')}
        error={refusal ?? undefined}
      >
        <div className="flex flex-col gap-2">
          {repos.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('kanban.repos.none')}</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {repos.map((path, index) => (
                <li
                  key={path}
                  className={cn(
                    'flex min-w-0 items-center gap-2 rounded-lg border py-1 pl-3 pr-1',
                    path === refused ? 'border-[var(--warn-dot)]' : 'border-border',
                  )}
                  data-repo-refused={path === refused ? '' : undefined}
                >
                  {/* The glyph beside the amber edge: a refused row is never marked by colour alone. */}
                  {path === refused && <span aria-hidden="true" className="shrink-0 text-xs text-warn-ink">▲</span>}
                  <span className="min-w-0 flex-1 break-all font-mono text-xs leading-snug text-foreground">{path}</span>
                  {index === 0 && repos.length > 1 && (
                    <Badge variant="outline" className="vv-badge--compact shrink-0">{t('kanban.repos.first')}</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground finger:h-11 finger:w-11"
                    aria-label={t('kanban.repos.remove', { path })}
                    onClick={() => onChange(repos.filter((held) => held !== path))}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ol>
          )}

          {offered.length > 0 && (
            <Select
              options={offered}
              // Never holds a value: a pick is added to the list above and the picker is ready for the next.
              value=""
              onChange={add}
              placeholder={t('kanban.repos.pick')}
              ariaLabel={t('kanban.repos.pick')}
              size="sm"
            />
          )}

          <div className="flex gap-2">
            <Input
              id={inputId}
              value={typed}
              onChange={(event) => onTypedChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addTyped();
              }}
              placeholder={t('kanban.repos.typePlaceholder')}
              className="font-mono text-xs finger:h-11"
              // Only when the refusal names no row: the path it refused is then nowhere but here.
              invalid={refusal !== null && refused === null}
            />
            <Button
              variant="tonal"
              size="sm"
              className="shrink-0 finger:h-11"
              disabled={typed.trim().length === 0}
              onClick={addTyped}
            >
              {t('kanban.repos.add')}
            </Button>
          </div>
        </div>
      </Field>
    </div>
  );
}
