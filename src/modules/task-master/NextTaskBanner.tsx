import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import { Badge, Banner, Button } from '@/shared/ui';
import { useTaskMaster } from '@/modules/task-master/context/TaskMasterContext';
import TaskDetailModal from '@/modules/task-master/modals/TaskDetailModal';
import TaskMasterSetupModal from '@/modules/task-master/modals/TaskMasterSetupModal';
import { taskStatusLabel, taskStatusTone } from '@/modules/task-master/utils/taskKanban';

type NextTaskBannerProps = {
  onShowAllTasks?: (() => void) | null;
  onStartTask?: (() => void) | null;
  className?: string;
};

/** Exported through the task-master barrel; the chat module's empty state renders it to surface the next task and prefill a prompt that starts it. */
export default function NextTaskBanner({ onShowAllTasks = null, onStartTask = null, className = '' }: NextTaskBannerProps) {
  const { t } = useTranslation('tasks');
  const {
    nextTask,
    tasks,
    currentProject,
    isLoadingTasks,
    projectTaskMaster,
    refreshTasks,
    setCurrentProject,
  } = useTaskMaster();

  // Whether the reader has opened the next task in full. A disclosure they control, so it is
  // not derivable from the task itself.
  const [showTaskDetail, setShowTaskDetail] = useState(false);
  // Whether the TaskMaster setup shell is open, for the same reason.
  const [showSetupModal, setShowSetupModal] = useState(false);

  if (!currentProject || isLoadingTasks) {
    return null;
  }

  const hasTasks = Array.isArray(tasks) && tasks.length > 0;
  const hasTaskMaster = Boolean(projectTaskMaster?.hasTaskmaster || currentProject.taskmaster?.hasTaskmaster);

  const handleSetupRefresh = () => {
    // setCurrentProject re-reads the project's TaskMaster details itself, so
    // the refreshProjects() that used to precede it was the same request twice.
    setCurrentProject(currentProject);
    void refreshTasks();
  };

  if (!hasTasks && !hasTaskMaster) {
    return (
      <>
        <div className={cn('mb-4', className)}>
          <Banner
            tone="neutral"
            action={
              <Button variant="tonal" size="sm" onClick={() => setShowSetupModal(true)}>
                {t('notConfigured.initializeButton')}
              </Button>
            }
          >
            {t('notConfigured.title')}
          </Banner>
        </div>

        <TaskMasterSetupModal
          isOpen={showSetupModal}
          project={currentProject}
          onClose={() => setShowSetupModal(false)}
          onAfterClose={handleSetupRefresh}
        />
      </>
    );
  }

  if (nextTask) {
    return (
      <>
        <div className={cn('mb-4 rounded-xl border border-border bg-card p-3', className)}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11.5px] text-ink-faint">
                  {nextTask.id}
                </span>
                {/* Two things, not one: "Up next" is a fixed word and would have been painted
                    with the task's STATUS tone — an amber badge reading "Up next" for a task in
                    review, colour saying one state and the word another. The badge carries the
                    status in both, exactly as a card does. */}
                <span className="text-xs text-ink-faint">{t('nextTask.label')}</span>
                <Badge tone={taskStatusTone(nextTask.status)}>{taskStatusLabel(nextTask.status, t)}</Badge>
              </div>
              <p className="line-clamp-1 text-sm font-medium text-foreground">{nextTask.title}</p>
            </div>

            <div className="flex flex-shrink-0 items-center gap-2">
              <Button size="sm" onClick={() => onStartTask?.()}>
                {t('nextTask.start')}
              </Button>

              <Button variant="outline" size="sm" onClick={() => setShowTaskDetail(true)}>
                {t('nextTask.open')}
              </Button>

              {onShowAllTasks && (
                <Button variant="outline" size="sm" onClick={onShowAllTasks}>
                  {t('nextTask.showAll')}
                </Button>
              )}
            </div>
          </div>
        </div>

        <TaskDetailModal
          task={nextTask}
          isOpen={showTaskDetail}
          onClose={() => setShowTaskDetail(false)}
          onStatusChange={() => {
            void refreshTasks();
          }}
        />
      </>
    );
  }

  if (hasTasks) {
    const completedTasks = tasks.filter((task) => task.status === 'done').length;
    const allDone = completedTasks === tasks.length;

    return (
      <div className={cn('mb-4', className)}>
        <Banner
          tone={allDone ? 'positive' : 'neutral'}
          action={
            onShowAllTasks ? (
              <Button variant="outline" size="sm" onClick={onShowAllTasks}>
                {t('nextTask.showAll')}
              </Button>
            ) : undefined
          }
        >
          {allDone ? t('nextTask.allDone') : t('nextTask.nonePending')}{' '}
          <span className="tabular-nums">{t('nextTask.count', { completed: completedTasks, total: tasks.length })}</span>
        </Banner>
      </div>
    );
  }

  return null;
}
