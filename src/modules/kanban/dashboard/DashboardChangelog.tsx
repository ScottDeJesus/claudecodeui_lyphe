import { ChevronRight, Copy } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanChangelogEntry, KanbanChangelogKind } from '@/shared/kanban-types';
import { Badge, Button, EmptyState } from '@/shared/ui';
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">{t('kanban.dashboard.changelog.title')}</h3>
        {entries.length > 0 && (
          <Button variant="outline" size="sm" className="finger:h-11" data-dashboard-copy onClick={onCopyMarkdown}>
            <Copy aria-hidden="true" />
            {t('kanban.dashboard.changelog.copy')}
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <EmptyState size="sm" title={t('kanban.dashboard.changelog.empty')} message={t('kanban.dashboard.changelog.emptyMessage')} />
      ) : (
        <ol className="flex flex-col gap-4">
          {entries.map((entry) => (
            <li key={`${entry.boardId}/${entry.cardId}`} className="flex flex-col gap-1.5">
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <time dateTime={entry.doneAt} className="font-mono tabular-nums">{formatShortDate(entry.doneAt) ?? '—'}</time>
                {entry.kind !== null && <Badge tone="neutral" className="vv-badge--compact">{t(KIND_KEYS[entry.kind])}</Badge>}
              </span>
              <span className="text-sm leading-snug text-foreground">{entry.changelog}</span>
              <Button
                variant="ghost"
                className="-mx-2 h-auto min-h-8 justify-start gap-1.5 self-start whitespace-normal px-2 py-1 text-left text-xs font-normal text-muted-foreground finger:min-h-11"
                data-dashboard-card={entry.cardId}
                onClick={() => onOpenCard(entry.cardId, entry.boardId)}
              >
                <span className="min-w-0 break-words">{allBoards ? t('kanban.dashboard.changelog.cardOn', { title: entry.title, board: entry.boardName }) : entry.title}</span>
                <ChevronRight className="shrink-0" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
