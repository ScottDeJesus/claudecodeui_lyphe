import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import { Badge, Meter, Tooltip } from '@/shared/ui';
import type { TaskMasterTask } from '@/shared/types';
import { taskStatusLabel, taskStatusTone } from '@/modules/task-master/utils/taskKanban';

type TaskCardProps = {
  task: TaskMasterTask;
  onClick?: (() => void) | null;
  showParent?: boolean;
  className?: string;
};

/**
 * How urgent a task is, as a line of text rather than a pill: three steps of ink weight, so
 * the row reads as a ladder instead of four badges competing with the status badge beside it.
 *
 * High is amber, never red. Red is for something destroyed or refused, and a task nobody has
 * started is neither (doctrine §5, plan D9).
 */
function priorityLine(priority: string | undefined, t: ReturnType<typeof useTranslation<'tasks'>>['t']) {
  if (priority === 'high') return { text: `▲ ${t('priorities.high')}`, className: 'text-warn-ink' };
  if (priority === 'medium') return { text: `▲ ${t('priorities.medium')}`, className: 'text-muted-foreground' };
  if (priority === 'low') return { text: t('priorities.low'), className: 'text-ink-faint' };
  return { text: t('priorities.unset'), className: 'text-ink-faint' };
}

function getSubtaskProgress(task: TaskMasterTask): { completed: number; total: number; percentage: number } {
  const subtasks = task.subtasks ?? [];
  const total = subtasks.length;
  const completed = subtasks.filter((subtask) => subtask.status === 'done').length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { completed, total, percentage };
}

/** Rendered by TaskBoardContent for one task tile, showing its status, priority and subtask progress. */
function TaskCard({ task, onClick = null, showParent = false, className = '' }: TaskCardProps) {
  const { t } = useTranslation('tasks');
  const progress = getSubtaskProgress(task);
  const priority = priorityLine(task.priority, t);

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-3.5 space-y-2.5',
        'transition-[transform,box-shadow] duration-move ease-enter',
        onClick ? 'cursor-pointer hover:-translate-y-1 hover:shadow-md' : 'cursor-default',
        // A finished task steps back rather than shouting; the board is about what is left.
        task.status === 'done' && 'opacity-80',
        className,
      )}
      onClick={onClick ?? undefined}
    >
      <div className="flex items-center gap-2">
        <Tooltip content={t('card.taskId', { id: task.id })}>
          <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11.5px] text-ink-faint">{task.id}</span>
        </Tooltip>

        <span className={cn('ml-auto text-[11px]', priority.className)}>{priority.text}</span>
      </div>

      <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{task.title}</h3>

      {showParent && task.parentId && (
        <p className="text-xs text-ink-faint">{t('card.partOf', { id: task.parentId })}</p>
      )}

      {Array.isArray(task.dependencies) && task.dependencies.length > 0 && (
        <p className="text-xs text-ink-faint">{t('card.waitsOn', { ids: task.dependencies.join(', ') })}</p>
      )}

      {progress.total > 0 && (
        <Meter
          percent={progress.percentage}
          label={t('card.subtasks')}
          value={t('card.subtaskCount', { completed: progress.completed, total: progress.total })}
        />
      )}

      <div className="flex">
        <Badge tone={taskStatusTone(task.status)}>{taskStatusLabel(task.status, t)}</Badge>
      </div>
    </div>
  );
}

export default memo(TaskCard);
