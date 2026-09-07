import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/shared/context/ToastContext';
import { PRDEditor } from '@/modules/prd-editor';
import { useTaskMaster } from '@/modules/task-master/context/TaskMasterContext';
import { useProjectPrdFiles } from '@/modules/task-master/hooks/useProjectPrdFiles';
import type { PrdFile, TaskMasterTask, TaskSelection } from '@/shared/types';
import TaskBoard from '@/modules/task-master/TaskBoard';
import TaskDetailModal from '@/modules/task-master/modals/TaskDetailModal';

type TaskMasterPanelProps = {
  isVisible: boolean;
};

/** Exported through the task-master barrel; the project-workspace module renders it as the workspace's Tasks tab. */
export default function TaskMasterPanel({ isVisible }: TaskMasterPanelProps) {
  const { t } = useTranslation('tasks');
  const { tasks, currentProject, refreshTasks } = useTaskMaster();
  const pushToast = useToast();

  const [selectedTask, setSelectedTask] = useState<TaskMasterTask | null>(null);
  const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);

  const [isPrdEditorOpen, setIsPrdEditorOpen] = useState(false);
  const [selectedPrd, setSelectedPrd] = useState<PrdFile | null>(null);

  const { prdFiles, refreshPrdFiles } = useProjectPrdFiles({ projectId: currentProject?.projectId });

  // The save is advisory: the document itself is the record that it happened, so this says so
  // once and leaves, instead of the panel holding its own timer and a fixed banner to say it.
  const refreshPrdData = useCallback(
    async (showNotification = false) => {
      await refreshPrdFiles();
      if (showNotification) {
        pushToast({ tone: 'positive', title: t('prd.saved') });
      }
    },
    [pushToast, refreshPrdFiles, t],
  );

  const handleTaskClick = useCallback(
    (taskSelection: TaskSelection) => {
      const selectedId = String(taskSelection.id);

      if (!taskSelection.title) {
        const fullTask = tasks.find((task) => String(task.id) === selectedId) ?? null;
        if (fullTask) {
          setSelectedTask(fullTask);
          setIsTaskDetailOpen(true);
        }
        return;
      }

      setSelectedTask(taskSelection as TaskMasterTask);
      setIsTaskDetailOpen(true);
    },
    [tasks],
  );

  return (
    <>
      <div className={`h-full ${isVisible ? 'block' : 'hidden'}`}>
        <div className="flex h-full flex-col overflow-hidden">
          <TaskBoard
            tasks={tasks}
            onTaskClick={handleTaskClick}
            showParentTasks
            className="flex-1 overflow-y-auto p-4"
            currentProject={currentProject}
            onTaskCreated={refreshTasks}
            onShowPRDEditor={(prd) => {
              setSelectedPrd(prd ?? null);
              setIsPrdEditorOpen(true);
            }}
            existingPRDs={prdFiles}
            onRefreshPRDs={(showNotification = false) => {
              void refreshPrdData(showNotification);
            }}
          />
        </div>
      </div>

      <TaskDetailModal
        task={selectedTask}
        isOpen={isTaskDetailOpen}
        onClose={() => {
          setIsTaskDetailOpen(false);
          setSelectedTask(null);
        }}
        onStatusChange={() => {
          void refreshTasks();
        }}
        onTaskClick={handleTaskClick}
      />

      {isPrdEditorOpen && (
        <PRDEditor
          project={currentProject}
          projectPath={currentProject?.fullPath || currentProject?.path}
          onClose={() => {
            setIsPrdEditorOpen(false);
            setSelectedPrd(null);
          }}
          isNewFile={!selectedPrd?.isExisting}
          file={{
            name: selectedPrd?.name || 'prd.txt',
            content: selectedPrd?.content || '',
            isExisting: selectedPrd?.isExisting,
          }}
          onSave={async () => {
            setIsPrdEditorOpen(false);
            setSelectedPrd(null);
            await refreshPrdData(true);
            await refreshTasks();
          }}
        />
      )}
    </>
  );
}
