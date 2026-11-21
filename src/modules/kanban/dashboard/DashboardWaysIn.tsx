import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanWayIn } from '@/shared/kanban-types';
import type { BugDashboardPart, DataTableColumn, TicketStats } from '@/shared/types';
import { Banner, DataTable, EmptyState, Readout, Rule } from '@/shared/ui';

/**
 * WHERE TICKETS CAME FROM: the cards opened in the window, by who or what opened them, and how many of those are still
 * open. Beside it, how many tickets came back.
 *
 * A SOURCE IS SAID IN WORDS. The board records the opener as one word (`operator`, `chat`, `nightly`); a reader is
 * shown what that word means ("Typed on the board", "The night's regression run"). A source this file has no words
 * for is shown as the board wrote it, never dropped: a new way in must not vanish from the count of ways in.
 *
 * TWO READS, AND EACH BLANKS ONLY ITSELF. The table is the board's own count. The two figures beside it are the
 * tickets', read from the dispatcher; when that read did not answer, its place says the dispatcher's sentence and
 * draws no number, and the table stands.
 *
 * CAME BACK IS TWO DIFFERENT THINGS, so it is two figures: a ticket that went quiet on its own and then happened
 * again (a flapping check), and a new ticket for a defect that was fixed once.
 */

type DashboardWaysInProps = {
  /** Cards opened in the window, by the actor of their creating event. */
  waysIn: KanbanWayIn[];
  /** The tickets' own counts, or the sentence of the read that did not answer. */
  tickets: BugDashboardPart<TicketStats>;
  /** The window, in days. */
  days: number;
};

/** The sources this file has words for. `human` is how boards older than the ticket line recorded a typed card. */
const SOURCE_KEYS: Record<string, string> = {
  operator: 'kanban.dashboard.waysIn.sources.operator',
  human: 'kanban.dashboard.waysIn.sources.operator',
  restorly: 'kanban.dashboard.waysIn.sources.restorly',
  chat: 'kanban.dashboard.waysIn.sources.chat',
  soul: 'kanban.dashboard.waysIn.sources.soul',
  nightly: 'kanban.dashboard.waysIn.sources.nightly',
  cerberus: 'kanban.dashboard.waysIn.sources.cerberus',
};

/** Rendered by BugDashboard, fourth. Nothing else mounts it. */
export function DashboardWaysIn({ waysIn, tickets, days }: DashboardWaysInProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const cameBackId = useId();
  const unknownLabel = t('kanban.dashboard.unknown');

  const columns: DataTableColumn<KanbanWayIn>[] = [
    { key: 'source', label: t('kanban.dashboard.waysIn.columns.source'), render: (way) => (way.source in SOURCE_KEYS ? t(SOURCE_KEYS[way.source]) : way.source) },
    { key: 'opened', label: t('kanban.dashboard.waysIn.columns.opened'), align: 'end', render: (way) => way.opened },
    { key: 'open', label: t('kanban.dashboard.waysIn.columns.open'), align: 'end', render: (way) => way.open },
  ];

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId} data-dashboard-ways-in>
      <div className="flex flex-col gap-0.5">
        <Rule id={headingId}>{t('kanban.dashboard.waysIn.title')}</Rule>
        <p className="text-xs text-muted-foreground">{t('kanban.dashboard.waysIn.about', { days })}</p>
      </div>

      <div className="grid items-start gap-x-10 gap-y-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        {waysIn.length === 0 ? (
          <EmptyState size="sm" title={t('kanban.dashboard.waysIn.empty', { days })} />
        ) : (
          <DataTable rows={waysIn} columns={columns} rowKey={(way) => way.source} label={t('kanban.dashboard.waysIn.title')} />
        )}

        <div className="flex min-w-0 flex-col gap-3" role="group" aria-labelledby={cameBackId} data-dashboard-came-back={tickets.ok ? 'read' : 'unread'}>
          <Rule id={cameBackId} level={4}>{t('kanban.dashboard.waysIn.cameBack.title')}</Rule>
          {tickets.ok ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 lg:grid-cols-1">
              <Readout
                label={t('kanban.dashboard.waysIn.cameBack.reopened')}
                value={tickets.value.came_back.reopened}
                unknownLabel={unknownLabel}
                note={t('kanban.dashboard.waysIn.cameBack.reopenedNote')}
              />
              <Readout
                label={t('kanban.dashboard.waysIn.cameBack.regressions')}
                value={tickets.value.came_back.regressions}
                unknownLabel={unknownLabel}
                note={t('kanban.dashboard.waysIn.cameBack.regressionsNote')}
              />
            </div>
          ) : (
            <Banner tone="warn">{t('kanban.dashboard.waysIn.ticketsFailed', { error: tickets.error })}</Banner>
          )}
        </div>
      </div>
    </section>
  );
}
