import { ChevronRight, Copy } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanChangelogEntry, KanbanChangelogKind } from '@/shared/kanban-types';
import { Button, EmptyState, Rule } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';

/**
 * THE CHANGELOG: what a person using the thing now sees, one sentence per finished card, newest first.
 *
 * THE SENTENCE LEADS. It is what the walk wrote for a reader and the largest text of the row; its day and its kind
 * stand before it as small marks, and the card it came from is a press under it, by its title. With every board in
 * scope the press names the card's board too.
 *
 * A KIND IS A WORD (Bug, UI change, Tweak, Regression), the same words the board's cards wear, and a card that
 * carries no kind draws none: a blank is truer than a guess.
 *
 * ONE PRESS COPIES THE LIST AS MARKDOWN, at the head of the section and beside its title, because it acts on the whole
 * list and not on a row. It is not drawn over an empty list: there is nothing to copy.
 */

type DashboardChangelogProps = {
  /** The finished cards' lines, newest first. */
  entries: KanbanChangelogEntry[];
  /** True when every board is in scope. */
  allBoards: boolean;
  /** Opens a card on its board. */
  onOpenCard: (cardId: string, boardId: string) => void;
  /** Copies the list as Markdown, one dated line per entry. */
  onCopyMarkdown: () => void;
};

/** The word each kind is drawn as: the board's own flow words, and the cure's. */
const KIND_KEYS: Record<KanbanChangelogKind, string> = {
  bug: 'kanban.flow.bug',
  'ui-change': 'kanban.flow.change',
  tweak: 'kanban.flow.tweak',
  regression: 'kanban.flow.cure',
};

/** Rendered by BugDashboard, sixth. Nothing else mounts it. */
export function DashboardChangelog({ entries, allBoards, onOpenCard, onCopyMarkdown }: DashboardChangelogProps) {
  const { t } = useTranslation();
  const headingId = useId();

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId} data-dashboard-changelog>
      <Rule
        id={headingId}
        end={
          entries.length > 0 && (
            <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 finger:size-11 finger:px-0" data-dashboard-copy aria-label={t('kanban.dashboard.changelog.copy')} title={t('kanban.dashboard.changelog.copy')} onClick={onCopyMarkdown}>
              <Copy aria-hidden="true" />
              <span className="font-sans text-xs normal-case tracking-normal finger:sr-only">{t('kanban.dashboard.changelog.copy')}</span>
            </Button>
          )
        }
      >
        {t('kanban.dashboard.changelog.title')}
      </Rule>

      {entries.length === 0 ? (
        <EmptyState size="sm" title={t('kanban.dashboard.changelog.empty')} message={t('kanban.dashboard.changelog.emptyMessage')} />
      ) : (
        <ol className="ast-trace">
          {entries.map((entry, index) => (
            <li key={`${entry.boardId}/${entry.cardId}`} className="ast-trace-item" data-latest={index === 0 ? 'true' : 'false'}>
              <span className="ast-trace-bead" aria-hidden="true" />
              <span className="ast-trace-head">
                <time dateTime={entry.doneAt}>{formatShortDate(entry.doneAt) ?? '—'}</time>
                {entry.kind !== null && <span className="ast-trace-src">{t(KIND_KEYS[entry.kind])}</span>}
              </span>
              <p className="ast-trace-text">{entry.changelog}</p>
              <button type="button" className="dash-link" data-dashboard-card={entry.cardId} onClick={() => onOpenCard(entry.cardId, entry.boardId)}>
                <span className="min-w-0 break-words">{allBoards ? t('kanban.dashboard.changelog.cardOn', { title: entry.title, board: entry.boardName }) : entry.title}</span>
                <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
