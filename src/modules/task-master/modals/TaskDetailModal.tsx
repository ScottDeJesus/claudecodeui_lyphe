import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Edit, Save, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn, copyTextToClipboard } from '@/shared/utils';
import { api } from '@/shared/api';
import { Badge, Button, Field, Input, Select } from '@/shared/ui';
import { useTaskMaster } from '@/modules/task-master/context/TaskMasterContext';
import { taskStatusLabel, taskStatusTone } from '@/modules/task-master/utils/taskKanban';
import type { TaskId, TaskMasterTask, TaskReference } from '@/shared/types';

type TaskDetailModalProps = {
  task: TaskMasterTask | null;
  isOpen?: boolean;
  className?: string;
  onClose: () => void;
  onEdit?: ((task: TaskMasterTask) => void) | null;
  onStatusChange?: ((taskId: TaskId, status: string) => void) | null;
  onTaskClick?: ((task: TaskReference) => void) | null;
};

/** The statuses a reader may move a task to, in workflow order. `blocked` is not among them: TaskMaster sets it, nobody picks it. */
const STATUS_VALUES = ['pending', 'in-progress', 'review', 'done', 'deferred', 'cancelled'];

/** The same three-step ink ladder the board's cards use. High is amber, never red (doctrine §5). */
function priorityInk(priority?: string): string {
  if (priority === 'high') return 'text-warn-ink';
  if (priority === 'medium') return 'text-muted-foreground';
  return 'text-ink-faint';
}

/** Rendered by TaskMasterPanel and NextTaskBanner to show and edit one task's full details and subtasks. */
export default function TaskDetailModal({
  task,
  isOpen = true,
  className = '',
  onClose,
  onEdit = null,
  onStatusChange = null,
  onTaskClick = null,
}: TaskDetailModalProps) {
  const { t } = useTranslation('tasks');
  const { currentProject, refreshTasks } = useTaskMaster();

  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showTestStrategy, setShowTestStrategy] = useState(false);
  const [editableTask, setEditableTask] = useState<TaskMasterTask | null>(task);

  useEffect(() => {
    setEditableTask(task);
    setIsEditMode(false);
  }, [task]);

  if (!isOpen || !task || !editableTask) {
    return null;
  }

  const handleSaveChanges = async () => {
    if (!currentProject?.projectId) {
      return;
    }

    const updates: Record<string, string> = {};

    if (editableTask.title !== task.title) {
      updates.title = editableTask.title;
    }

    if (editableTask.description !== task.description) {
      updates.description = editableTask.description ?? '';
    }

    if (editableTask.details !== task.details) {
      updates.details = editableTask.details ?? '';
    }

    if (Object.keys(updates).length === 0) {
      setIsEditMode(false);
      return;
    }

    setIsSaving(true);
    try {
      const response = await api.taskmaster.updateTask(currentProject.projectId, task.id, updates);
      if (!response.ok) {
        const errorPayload = (await response.json()) as { message?: string };
        throw new Error(errorPayload.message ?? 'Failed to update task');
      }

      setIsEditMode(false);
      await refreshTasks();
      onEdit?.(editableTask);
    } catch (error) {
      console.error('Failed to save task changes:', error);
      alert(error instanceof Error ? error.message : 'Failed to update task');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatusSelect = async (nextStatus: string) => {
    if (!currentProject?.projectId || nextStatus === task.status) {
      return;
    }

    try {
      const response = await api.taskmaster.updateTask(currentProject.projectId, task.id, { status: nextStatus });
      if (!response.ok) {
        const errorPayload = (await response.json()) as { message?: string };
        throw new Error(errorPayload.message ?? 'Failed to update task status');
      }

      await refreshTasks();
      onStatusChange?.(task.id, nextStatus);
    } catch (error) {
      console.error('Failed to update task status:', error);
      alert(error instanceof Error ? error.message : 'Failed to update task status');
    }
  };

  return (
    <div className={cn('fixed inset-0 z-[100] flex items-center justify-center md:p-4', className)}>
      <div className="vv-dialog__backdrop absolute inset-0" onClick={onClose} aria-hidden />

      <div className="vv-dialog__panel relative flex h-full w-full flex-col max-md:rounded-none md:h-[90vh] md:max-w-4xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4 md:p-6">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => copyTextToClipboard(String(task.id))}
                className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 font-mono text-xs text-ink-faint"
                title={t('detail.copyId')}
              >
                <span>{task.id}</span>
                <Copy className="h-3 w-3" />
              </button>

              <Badge tone={taskStatusTone(task.status)}>{taskStatusLabel(task.status, t)}</Badge>
            </div>

            {isEditMode ? (
              <Input
                type="text"
                value={editableTask.title}
                aria-label={t('detail.titleField')}
                onChange={(event) => setEditableTask({ ...editableTask, title: event.target.value })}
                className="h-10 text-lg font-semibold"
              />
            ) : (
              <h1 className="line-clamp-2 text-lg font-semibold text-foreground md:text-xl">{task.title}</h1>
            )}
          </div>

          <div className="flex flex-none items-center gap-1">
            {isEditMode ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSaveChanges}
                  disabled={isSaving}
                  title={t('detail.save')}
                  aria-label={t('detail.save')}
                >
                  <Save className={cn(isSaving && 'animate-spin')} />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditableTask(task);
                    setIsEditMode(false);
                  }}
                  disabled={isSaving}
                  title={t('detail.cancelEdit')}
                  aria-label={t('detail.cancelEdit')}
                >
                  <X />
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditMode(true)}
                title={t('detail.edit')}
                aria-label={t('detail.edit')}
              >
                <Edit />
              </Button>
            )}

            <Button variant="ghost" size="icon" onClick={onClose} title={t('createTask.close')} aria-label={t('createTask.close')}>
              <X />
            </Button>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-4 md:p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label={t('filters.status')}>
              <Select
                ariaLabel={t('filters.status')}
                value={task.status ?? 'pending'}
                onChange={(nextStatus) => {
                  void handleStatusSelect(nextStatus);
                }}
                options={STATUS_VALUES.map((value) => ({ value, label: t(`statuses.${value}`, value) }))}
              />
            </Field>

            <Field label={t('filters.priority')}>
              <span className={cn('text-sm font-medium', priorityInk(task.priority))}>
                {task.priority ? t(`priorities.${task.priority}`, task.priority) : t('priorities.unset')}
              </span>
            </Field>

            <Field label={t('detail.dependencies')}>
              {Array.isArray(task.dependencies) && task.dependencies.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {task.dependencies.map((dependency) => (
                    <Button
                      key={String(dependency)}
                      variant="outline"
                      size="sm"
                      onClick={() => onTaskClick?.({ id: dependency })}
                    >
                      {dependency}
                    </Button>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-ink-faint">{t('detail.noDependencies')}</span>
              )}
            </Field>
          </div>

          <Field label={t('detail.description')}>
            {isEditMode ? (
              <textarea
                rows={4}
                value={editableTask.description ?? ''}
                aria-label={t('detail.description')}
                onChange={(event) => setEditableTask({ ...editableTask, description: event.target.value })}
                className="w-full rounded-lg border-[1.5px] border-input bg-card px-3 py-2 text-sm text-foreground"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-secondary-foreground">
                {task.description || t('detail.noDescription')}
              </p>
            )}
          </Field>

          {task.details && (
            <div className="rounded-xl border border-border">
              <button
                type="button"
                onClick={() => setShowDetails((current) => !current)}
                className="flex w-full items-center justify-between p-4 text-left text-sm font-medium text-foreground"
              >
                <span>{t('detail.implementation')}</span>
                {showDetails ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {showDetails && (
                <div className="border-t border-border p-4">
                  <p className="whitespace-pre-wrap text-sm text-secondary-foreground">{task.details}</p>
                </div>
              )}
            </div>
          )}

          {task.testStrategy && (
            <div className="rounded-xl border border-border">
              <button
                type="button"
                onClick={() => setShowTestStrategy((current) => !current)}
                className="flex w-full items-center justify-between p-4 text-left text-sm font-medium text-foreground"
              >
                <span>{t('detail.howItIsChecked')}</span>
                {showTestStrategy ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {showTestStrategy && (
                <div className="border-t border-border bg-secondary p-4">
                  <p className="whitespace-pre-wrap text-sm text-secondary-foreground">{task.testStrategy}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
