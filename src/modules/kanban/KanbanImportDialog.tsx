import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanImportCounts, KanbanImportResult } from '@/shared/kanban-types';
import { api, readApiJson } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import { Banner, Button, Dialog, DialogContent, Field, Input, Spinner } from '@/shared/ui';

/**
 * BRINGING A DESCENT BOARD ACROSS: where to read it from, one press, and the reckoning afterwards.
 *
 * THE RECKONING IS THE POINT. An import that reports "done" tells the reader nothing they can
 * check; two columns of counts — what the source holds, what this board holds now — let them see
 * in one glance that 449 cards became 449 cards. That is why the table is the dialog's largest
 * element and the button is not.
 *
 * THE TWO COLUMNS ARE NOT EXPECTED TO MATCH, and the headings say so rather than the numbers
 * pretending: `imported` is what THIS board holds after the run, so a card written here — one
 * Descent has never seen — is a difference and not a loss. A re-import is safe for the same
 * reason: every row carries its Descent id, so the second run updates what it matched and adds
 * nothing it already added.
 *
 * NOTHING IN DESCENT IS WRITTEN, and the field says it under the path rather than in a paragraph
 * nobody reads: the source is opened read-only. That sentence is the whole answer to the question
 * a reader has before pressing a button that names another application's database.
 *
 * THE FIELD PREFILLS WITH A DISPLAY PATH. `~` is spelled because that is how the operator says
 * where their Descent lives; the server expands nothing, so an untouched field must be sent as
 * NO path at all and the server resolves its own default from the home directory. The marker
 * below carries that rule, because getting it wrong is a 404 against a file that is right there.
 */

/** What the operator's Descent install is called, as a human writes it. Display only. */
const DEFAULT_DESCENT_DB_PATH = '~/.claude/descent/descent.db';

/** The ten tallies one import reports, in the order the importer writes them. */
const COUNT_ROWS = [
  { key: 'boards', labelKey: 'kanban.import.rows.boards' },
  { key: 'cards', labelKey: 'kanban.import.rows.cards' },
  { key: 'tags', labelKey: 'kanban.import.rows.tags' },
  { key: 'questions', labelKey: 'kanban.import.rows.questions' },
  { key: 'issues', labelKey: 'kanban.import.rows.issues' },
  { key: 'decisions', labelKey: 'kanban.import.rows.decisions' },
  { key: 'checklist', labelKey: 'kanban.import.rows.checklist' },
  { key: 'attachments', labelKey: 'kanban.import.rows.attachments' },
  { key: 'events', labelKey: 'kanban.import.rows.events' },
  { key: 'settings', labelKey: 'kanban.import.rows.settings' },
] satisfies { key: keyof KanbanImportCounts; labelKey: string }[];

/** One run of the import, as this dialog reports it. */
type ImportRun = {
  running: boolean;
  result: KanbanImportResult | null;
  /** The server's own sentence when the run did not complete. */
  error: string | null;
};

type KanbanImportDialogProps = {
  open: boolean;
  /** Closing re-reads the board: an import can add a board, rewrite the one on screen and select
   *  another, and this dialog has no way to know which of those happened. */
  onClose: () => void;
};

/** Opened by the board header's "Import from Descent" row, through KanbanPanel. */
export function KanbanImportDialog({ open, onClose }: KanbanImportDialogProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const pathId = useId();
  const titleId = useId();

  const [path, setPath] = useState(DEFAULT_DESCENT_DB_PATH);
  const [run, setRun] = useState<ImportRun>({ running: false, result: null, error: null });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * THE ONE PRESS. The field is read at the moment of the press rather than from a state seeded
   * beside it, because the path is the only thing this dialog has to say to the server.
   *
   * AN UNTOUCHED FIELD SENDS NO PATH AT ALL. The prefill is a DISPLAY path — `~` is how the
   * operator says where their Descent lives — and the server expands no tilde: sending the display
   * string back would be a 404 against a file that is right there. So the default is sent as an
   * absent `dbPath` and the server resolves its own from the home directory.
   *
   * A PREVIOUS RESULT STANDS UNTIL THE NEW ONE ANSWERS. Clearing the table on the press would take
   * the counts away at the exact moment the reader pressed to change them, and a run that then
   * failed would leave them with neither answer.
   */
  const start = useCallback(async () => {
    const entered = path.trim();
    setRun((held) => ({ ...held, running: true, error: null }));

    try {
      const result = await readApiJson<KanbanImportResult>(
        await api.kanban.importDescent(
          entered === '' || entered === DEFAULT_DESCENT_DB_PATH ? {} : { dbPath: entered }
        )
      );
      if (!mountedRef.current) return;
      setRun({ running: false, result, error: null });
      toast({
        tone: 'positive',
        title: t('kanban.import.done'),
        message: t('kanban.import.counts', {
          inserted: result.inserted.toLocaleString(),
          updated: result.updated.toLocaleString(),
        }),
      });
      return;
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : t('kanban.import.failed');
      if (!mountedRef.current) return;
      // The banner AND the toast: the banner is the answer for the reader still looking at the
      // dialog, and the toast is the one that finds them if they close it while the run is out.
      setRun((held) => ({ running: false, result: held.result, error: message }));
      toast({ tone: 'warn', title: t('kanban.import.failed'), message });
    }
  }, [path, t, toast]);

  const counts = run.result;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A run in flight holds the dialog open. Closing mid-import fires the panel's re-read over
        // a half-written board, and the board is then never read again when the run actually
        // lands — the reader is left looking at a state that was true for neither.
        if (!next && !run.running) onClose();
      }}
    >
      <DialogContent aria-labelledby={titleId} className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-5">
        <h2 id={titleId} className="text-base font-medium text-foreground">{t('kanban.import.title')}</h2>

        <Field
          label={t('kanban.import.pathLabel')}
          htmlFor={pathId}
          helper={t('kanban.import.pathHelper')}
        >
          <Input
            id={pathId}
            value={path}
            onChange={(event) => setPath(event.target.value)}
            aria-describedby={`${pathId}-helper`}
            placeholder={DEFAULT_DESCENT_DB_PATH}
            className="vv-tabular text-xs"
            disabled={run.running}
          />
        </Field>

        {run.error !== null && <Banner tone="warn">{run.error}</Banner>}

        {counts !== null && (
          <div className="flex flex-col gap-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="py-1 text-left text-xs font-medium text-muted-foreground">
                    {t('kanban.import.table.row')}
                  </th>
                  <th scope="col" className="py-1 text-right text-xs font-medium text-muted-foreground">
                    {t('kanban.import.table.source')}
                  </th>
                  <th scope="col" className="py-1 text-right text-xs font-medium text-muted-foreground">
                    {t('kanban.import.table.imported')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {COUNT_ROWS.map((row) => (
                  <tr key={row.key}>
                    <th scope="row" className="py-1 text-left text-sm font-normal text-muted-foreground">
                      {t(row.labelKey)}
                    </th>
                    {/* Tabular figures, right-aligned: the whole point of this table is reading
                        one column against the other, and proportional digits make two equal
                        numbers look unequal. */}
                    <td className="vv-tabular py-1 text-right text-foreground">
                      {counts.source[row.key].toLocaleString()}
                    </td>
                    <td className="vv-tabular py-1 text-right text-foreground">
                      {counts.imported[row.key].toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="text-xs text-muted-foreground">
              {t('kanban.import.summary', {
                inserted: counts.inserted.toLocaleString(),
                updated: counts.updated.toLocaleString(),
              })}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          {run.running && <Spinner size={18} label={t('kanban.import.running')} />}
          <Button variant="ghost" className="ml-auto" onClick={onClose} disabled={run.running}>
            {counts === null ? t('kanban.import.cancel') : t('kanban.import.close')}
          </Button>
          <Button
            onClick={() => { void start(); }}
            // A run at a time, and never at an empty field: an empty path is a press with nothing
            // behind it, and the server's default is what the prefilled field already means.
            disabled={run.running || path.trim().length === 0}
          >
            {counts === null ? t('kanban.import.run') : t('kanban.import.again')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
