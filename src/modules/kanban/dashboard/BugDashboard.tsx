import { CloudOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DashboardCases } from '@/modules/kanban/dashboard/DashboardCases';
import { DashboardChangelog } from '@/modules/kanban/dashboard/DashboardChangelog';
import { DashboardFlow } from '@/modules/kanban/dashboard/DashboardFlow';
import { DashboardNumbers } from '@/modules/kanban/dashboard/DashboardNumbers';
import { DashboardOldest } from '@/modules/kanban/dashboard/DashboardOldest';
import { DashboardWaysIn } from '@/modules/kanban/dashboard/DashboardWaysIn';
import { useBugDashboard } from '@/modules/kanban/dashboard/useBugDashboard';
import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { BugDashboardView } from '@/shared/types';
import { Banner, EmptyState, SegmentedControl, Select, Spinner } from '@/shared/ui';
import { copyTextToClipboard } from '@/shared/utils';

/**
 * THE BUGS VIEW'S DASHBOARD FACE: how the board stands, in the order a person asks it. How many are open and how bad;
 * is the board keeping up; what has waited longest; where the work comes from; what the night's cases say; what got
 * fixed. Last, and only while there are any, the tickets no board could take.
 *
 * TWO CONTROLS, AND THEY STAY PUT. Which boards (this one, or all) and how far back (7, 30 or 90 days) stand at the
 * head in every state, a spinner and a failure included, so the way to ask a different question never moves. What
 * they are set to is the panel's, not this face's: it survives a visit to the Board face and a board switch.
 *
 * ONE READ, FOUR STATES. Still reading: the ring, under the controls. The route did not answer: one sentence and
 * Try again. An answer with nothing in it: every section says its own nothing. An answer: the sections. A newer
 * answer replaces the one drawn without a spinner between them, and the face says it is busy to assistive tech only.
 *
 * A PART THAT DID NOT ANSWER BLANKS ITS OWN SECTION. The board's numbers are this server's and always arrive with the
 * answer; the cases and the tickets are the house's, and each may be a refusal. The section it feeds says the
 * refusal's sentence and draws no number; every other section stands.
 *
 * IT COMPOSES, IT DOES NOT BUILD. Every piece is the kit's, and each section is a file of its own that is handed its
 * part of the answer and fetches nothing.
 */

type BugDashboardProps = {
  /** The open board: what "This board" asks about. */
  boardId: string;
  /** Which boards and how far back, kept by the panel. */
  view: BugDashboardView;
  onView: (view: BugDashboardView) => void;
  /** Opens a card on its board: the Board face, that board, that card's sheet. */
  onOpenCard: (cardId: string, boardId: string) => void;
};

/** The windows offered, in days. */
const WINDOWS: BugDashboardView['days'][] = [7, 30, 90];

/** Rendered by KanbanPanel while its face is the dashboard. Nothing else mounts it. */
export function BugDashboard({ boardId, view, onView, onOpenCard }: BugDashboardProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const allBoards = view.scope === 'all';

  const scope = allBoards ? 'all' : boardId;
  const { reading, retry } = useBugDashboard(scope, view.days);

  // The copy is the same changelog the section draws, asked as Markdown, so what lands on the clipboard is what the screen says.
  const copyChangelog = async () => {
    try {
      const response = await api.kanban.changelogMarkdown(scope);
      if (!response.ok) throw new Error(`The changelog request failed with status ${response.status}.`);
      const text = await response.text();
      const copied = await copyTextToClipboard(text);
      if (!copied) throw new Error('The clipboard refused the changelog.');
      toast({ tone: 'positive', title: t('kanban.toast.changelogCopied') });
    } catch (error) {
      console.error('Error copying the changelog:', error);
      toast({ tone: 'warn', title: t('kanban.toast.changelogNotCopied') });
    }
  };

  const copyMarkdown = () => {
    void copyChangelog();
  };

  const body = () => {
    if (reading.status === 'loading') {
      return (
        <div className="flex justify-center py-16">
          <Spinner label={t('kanban.dashboard.loading')} />
        </div>
      );
    }

    if (reading.status === 'unreachable') {
      return (
        <EmptyState
          icon={CloudOff}
          title={t('kanban.dashboard.unreachable.title')}
          message={t('kanban.dashboard.unreachable.message')}
          actionLabel={t('kanban.dashboard.unreachable.retry')}
          onAction={retry}
        />
      );
    }

    const { stats, changelog, cases, tickets } = reading.answer;
    const unplaced = tickets.ok ? tickets.value.unplaced : [];

    return (
      <>
        <DashboardNumbers stats={stats} allBoards={allBoards} onOpenCard={onOpenCard} />
        <DashboardFlow byDay={stats.byDay} days={view.days} />
        <DashboardOldest cards={stats.oldestOpen} allBoards={allBoards} onOpenCard={onOpenCard} />
        <DashboardWaysIn waysIn={stats.waysIn} tickets={tickets} days={view.days} />
        <DashboardCases cases={cases} days={view.days} onOpenCard={onOpenCard} />
        <DashboardChangelog entries={changelog} allBoards={allBoards} onOpenCard={onOpenCard} onCopyMarkdown={copyMarkdown} />
        {unplaced.length > 0 && (
          <div data-dashboard-unplaced>
            <Banner tone="warn">
              <p className="font-medium">{t('kanban.dashboard.unplaced.title', { count: unplaced.length })}</p>
              <p>{t('kanban.dashboard.unplaced.about', { count: unplaced.length })}</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {unplaced.map((ticket) => (
                  <li key={ticket.id} className="flex flex-col">
                    <span className="break-words">{ticket.title}</span>
                    <span className="break-all font-mono text-xs">{ticket.path}</span>
                  </li>
                ))}
              </ul>
            </Banner>
          </div>
        )}
      </>
    );
  };

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto"
      data-bug-dashboard={reading.status}
      aria-busy={reading.status === 'loading' || (reading.status === 'ready' && reading.stale)}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-9 p-4 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            label={t('kanban.dashboard.scope.label')}
            options={[
              { value: 'board', label: t('kanban.dashboard.scope.board') },
              { value: 'all', label: t('kanban.dashboard.scope.all') },
            ]}
            value={view.scope}
            onChange={(scope) => onView({ ...view, scope })}
          />
          {/* A block wrapper at a fixed width: `Select`'s root is a block, and as a flex item it would shrink to its text. */}
          <div className="w-40">
            <Select
              size="sm"
              ariaLabel={t('kanban.dashboard.window.label')}
              options={WINDOWS.map((days) => ({ value: String(days), label: t('kanban.dashboard.window.days', { days }) }))}
              value={String(view.days)}
              onChange={(next) => {
                const days = WINDOWS.find((candidate) => String(candidate) === next);
                if (days !== undefined) onView({ ...view, days });
              }}
            />
          </div>
        </div>

        {body()}
      </div>
    </div>
  );
}
