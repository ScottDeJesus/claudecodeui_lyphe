import type { TFunction } from 'i18next';

import type { TaskKanbanColumn, TaskMasterTask, Tone } from '@/shared/types';

/**
 * The board's columns, in the order a task moves through them.
 *
 * `titleKey` is the ONLY place a status is given words, so the column heading and the badge on
 * a card in it always read the same. The tone is what the heading and the badge are painted
 * with; there is no colour here, because a screen does not choose colours — it names a state
 * and the `[data-tone]` block in tokens.css decides what that looks like.
 */
const KANBAN_COLUMN_CONFIG = [
  { id: 'pending', titleKey: 'kanban.pending', status: 'pending' },
  { id: 'in-progress', titleKey: 'kanban.inProgress', status: 'in-progress' },
  { id: 'review', titleKey: 'kanban.review', status: 'review' },
  { id: 'done', titleKey: 'kanban.done', status: 'done' },
  { id: 'blocked', titleKey: 'kanban.blocked', status: 'blocked' },
  { id: 'deferred', titleKey: 'kanban.deferred', status: 'deferred' },
  { id: 'cancelled', titleKey: 'kanban.cancelled', status: 'cancelled' },
] as const;

/** Always shown, even with nothing in them, because they are the workflow the board is for. */
const CORE_WORKFLOW_STATUSES = new Set(['pending', 'in-progress', 'done']);

/**
 * What each task status means in the app's five-tone vocabulary.
 *
 * Read by TaskBoardContent for the column headings and by TaskCard for the badge on a tile —
 * one map, so the two can never disagree about what a status is. `blocked` is warn rather
 * than danger: it is work waiting, not something destroyed or refused, and red is kept for
 * those (doctrine §5).
 */
const TASK_STATUS_TONE: Record<string, Tone> = {
  pending: 'neutral',
  'in-progress': 'info',
  review: 'warn',
  done: 'positive',
  blocked: 'warn',
  deferred: 'neutral',
  cancelled: 'neutral',
};

/** The tone of a task status, falling back to neutral for a status a newer TaskMaster invented. */
export function taskStatusTone(status?: string): Tone {
  return (status && TASK_STATUS_TONE[status]) || 'neutral';
}

/**
 * The mark that goes beside a tone, so a state survives with the colour drained out
 * (doctrine §6). These are the `--tone-glyph` values from tokens.css: Badge paints the tone
 * but does not draw the glyph, so a caller that needs one spells it.
 */
const TONE_MARK: Record<Tone, string> = {
  neutral: '·',
  info: '●',
  positive: '✓',
  warn: '▲',
  danger: '✕',
};

/** A status as a card should show it: its mark and the same words its column heading uses. */
export function taskStatusLabel(status: string | undefined, t: TFunction<'tasks'>): string {
  const column = KANBAN_COLUMN_CONFIG.find((candidate) => candidate.status === status);
  const words = column ? t(column.titleKey) : t('kanban.pending');
  return `${TONE_MARK[taskStatusTone(status)]} ${words}`;
}

export function buildKanbanColumns(tasks: TaskMasterTask[], t: TFunction<'tasks'>): TaskKanbanColumn[] {
  const tasksByStatus = tasks.reduce<Record<string, TaskMasterTask[]>>((accumulator, task) => {
    const status = task.status ?? 'pending';
    if (!accumulator[status]) {
      accumulator[status] = [];
    }
    accumulator[status].push(task);
    return accumulator;
  }, {});

  return KANBAN_COLUMN_CONFIG.filter((column) => {
    const hasTasks = (tasksByStatus[column.status] ?? []).length > 0;
    return hasTasks || CORE_WORKFLOW_STATUSES.has(column.status);
  }).map((column) => ({
    id: column.id,
    title: t(column.titleKey),
    status: column.status,
    // A Verve column has one colour and it is its tone, which the heading reads through
    // `taskStatusTone`. `TaskKanbanColumn` still declares these two Tailwind class strings
    // from the board's pre-Verve paint; collapsing them into the tone means editing
    // src/shared/types.ts, which this phase does not own.
    color: '',
    headerColor: '',
    tasks: tasksByStatus[column.status] ?? [],
  }));
}
