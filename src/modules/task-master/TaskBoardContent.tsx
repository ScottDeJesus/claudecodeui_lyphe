import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import { Badge, EmptyState } from '@/shared/ui';
import type { TaskBoardView, TaskKanbanColumn, TaskMasterTask, TaskSelection } from '@/shared/types';
import TaskCard from '@/modules/task-master/TaskCard';
import { taskStatusTone } from '@/modules/task-master/utils/taskKanban';

type TaskBoardContentProps = {
  viewMode: TaskBoardView;
  filteredTaskCount: number;
  kanbanColumns: TaskKanbanColumn[];
  filteredTasks: TaskMasterTask[];
  showParentTasks: boolean;
  onTaskClick: (task: TaskSelection) => void;
};

/** What an empty column says, phrased for the column it is standing in. */
function emptyColumnMessage(status: string, t: ReturnType<typeof useTranslation<'tasks'>>['t']): string {
  if (status === 'pending') return t('kanban.tasksWillAppear');
  if (status === 'in-progress') return t('kanban.moveTasksHere');
  if (status === 'done') return t('kanban.completedTasksHere');
  return t('kanban.statusTasksHere');
}

function KanbanColumns({
  columns,
  showParentTasks,
  onTaskClick,
}: {
  columns: TaskKanbanColumn[];
  showParentTasks: boolean;
  onTaskClick: (task: TaskSelection) => void;
}) {
  const { t } = useTranslation('tasks');

  return (
    <div
      className={cn(
        'grid gap-5 items-start',
        columns.length === 1 && 'grid-cols-1 max-w-md mx-auto',
        columns.length === 2 && 'grid-cols-1 md:grid-cols-2',
        columns.length === 3 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
        columns.length === 4 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
        columns.length === 5 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
        columns.length >= 6 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
      )}
    >
      {columns.map((column) => (
        <div key={column.id} className="flex min-w-0 flex-col gap-2.5">
          {/* The heading IS the column's state, so it carries the tone and the count sits
              beside it as the plain number it is. */}
          <div className="flex items-center gap-2 px-1">
            <Badge tone={taskStatusTone(column.status)}>{column.title}</Badge>
            <span className="text-xs tabular-nums text-ink-faint">{column.tasks.length}</span>
          </div>

          <div className="max-h-[calc(100vh-300px)] space-y-2.5 overflow-y-auto">
            {column.tasks.length === 0 ? (
              <EmptyState title={t('kanban.noTasksYet')} message={emptyColumnMessage(column.status, t)} />
            ) : (
              column.tasks.map((task) => (
                <TaskCard
                  key={String(task.id)}
                  task={task}
                  onClick={() => onTaskClick(task)}
                  showParent={showParentTasks}
                  className="w-full"
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Rendered by TaskBoard to lay the filtered tasks out in the selected kanban or list view. */
export default function TaskBoardContent({
  viewMode,
  filteredTaskCount,
  kanbanColumns,
  filteredTasks,
  showParentTasks,
  onTaskClick,
}: TaskBoardContentProps) {
  const { t } = useTranslation('tasks');

  if (filteredTaskCount === 0) {
    return (
      <div className="flex justify-center py-12">
        <EmptyState title={t('noMatchingTasks.title')} message={t('noMatchingTasks.description')} />
      </div>
    );
  }

  if (viewMode === 'kanban') {
    return <KanbanColumns columns={kanbanColumns} showParentTasks={showParentTasks} onTaskClick={onTaskClick} />;
  }

  return (
    <div className={cn('gap-4', viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'space-y-4')}>
      {filteredTasks.map((task) => (
        <TaskCard
          key={String(task.id)}
          task={task}
          onClick={() => onTaskClick(task)}
          showParent={showParentTasks}
          className={viewMode === 'grid' ? 'h-full' : ''}
        />
      ))}
    </div>
  );
}
