import { Suspense, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { HEAD_PRESS } from '@/shared/constants';
import { Badge, Button } from '@/shared/ui';
import type { TaskMasterProject } from '@/shared/types';
import { Shell } from '@/modules/shell';

type TaskMasterSetupModalProps = {
  isOpen: boolean;
  project: TaskMasterProject | null;
  onClose: () => void;
  onAfterClose?: (() => void) | null;
};

/** Rendered by TaskBoard and NextTaskBanner to run TaskMaster initialisation for a project in an embedded shell. */
export default function TaskMasterSetupModal({ isOpen, project, onClose, onAfterClose = null }: TaskMasterSetupModalProps) {
  const { t } = useTranslation('tasks');
  const [isTaskMasterComplete, setIsTaskMasterComplete] = useState(false);

  if (!isOpen || !project) {
    return null;
  }

  const closeModal = () => {
    onClose();
    setIsTaskMasterComplete(false);

    // Delay refresh slightly so the CLI has time to flush writes to disk.
    window.setTimeout(() => {
      onAfterClose?.();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16">
      <div className="vv-dialog__backdrop absolute inset-0" onClick={closeModal} aria-hidden />

      <div className="vv-dialog__panel relative flex h-[600px] w-full max-w-4xl flex-col">
        <div className="flex items-center gap-3 border-b border-border p-4">
          <Button variant="outline" size="icon" className={HEAD_PRESS} onClick={closeModal} aria-label={t('createTask.close')} title={t('createTask.close')}>
            <ArrowLeft aria-hidden="true" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t('setupModal.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('setupModal.subtitle', { projectName: project.displayName })}</p>
          </div>

        </div>

        <div className="min-h-0 flex-1 p-4">
          <div className="h-full overflow-hidden rounded-xl border border-border">
            <Suspense fallback={null}>
            <Shell
              selectedProject={project}
              selectedSession={null}
              initialCommand="npx task-master init"
              isPlainShell
              isActive
              onProcessComplete={(exitCode) => {
                if (exitCode === 0) {
                  setIsTaskMasterComplete(true);
                }
              }}
            />
            </Suspense>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border p-4">
          {isTaskMasterComplete ? (
            <Badge tone="positive">✓ {t('setupModal.completed')}</Badge>
          ) : (
            <span className="text-sm text-muted-foreground">{t('setupModal.willStart')}</span>
          )}

          <Button variant={isTaskMasterComplete ? 'default' : 'outline'} size="sm" onClick={closeModal}>
            {isTaskMasterComplete ? t('setupModal.closeContinueButton') : t('setupModal.closeButton')}
          </Button>
        </div>
      </div>
    </div>
  );
}
