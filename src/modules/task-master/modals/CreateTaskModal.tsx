import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';

type CreateTaskModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

/** Rendered by TaskBoard to explain how tasks are created through chat and the TaskMaster CLI. */
export default function CreateTaskModal({ isOpen, onClose }: CreateTaskModalProps) {
  const { t } = useTranslation('tasks');

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="vv-dialog__backdrop absolute inset-0" onClick={onClose} aria-hidden />

      <div className="vv-dialog__panel relative w-full max-w-md">
        <div className="flex items-center justify-between border-b border-border p-5">
          <h3 className="text-lg font-semibold text-foreground">{t('createTask.title')}</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('createTask.close')}>
            <X />
          </Button>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <h4 className="mb-1.5 font-medium text-foreground">{t('createTask.askTitle')}</h4>
            <p className="text-sm text-muted-foreground">{t('createTask.askDescription')}</p>
          </div>

          <div className="rounded-lg border border-border bg-secondary p-3">
            <p className="mb-1 text-xs font-medium text-ink-faint">{t('createTask.exampleLabel')}</p>
            <p className="font-mono text-sm text-foreground">{t('createTask.example')}</p>
          </div>

          <a
            href="https://github.com/eyaltoledano/claude-task-master/blob/main/docs/examples.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-medium text-primary underline underline-offset-4"
          >
            {t('createTask.docsLink')}
          </a>

          <Button variant="outline" className="w-full" onClick={onClose}>
            {t('createTask.dismiss')}
          </Button>
        </div>
      </div>
    </div>
  );
}
