import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';

type TaskHelpModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreatePrd: () => void;
};

const HELP_STEPS = ['createPRD', 'generateTasks', 'analyzeTasks', 'startBuilding'];
const PRO_TIPS = ['search', 'views', 'filters', 'details'];

/** Rendered by TaskBoard to walk through the PRD-to-tasks workflow. */
export default function TaskHelpModal({ isOpen, onClose, onCreatePrd }: TaskHelpModalProps) {
  const { t } = useTranslation('tasks');

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="vv-dialog__backdrop absolute inset-0" onClick={onClose} aria-hidden />

      <div className="vv-dialog__panel relative max-h-[90vh] w-full max-w-3xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t('helpGuide.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('helpGuide.subtitle')}</p>
          </div>

          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('createTask.close')}>
            <X />
          </Button>
        </div>

        <div className="max-h-[calc(90vh-120px)] space-y-3 overflow-y-auto p-5">
          {HELP_STEPS.map((step, index) => (
            <div key={step} className="rounded-xl border border-border bg-card p-4">
              <h4 className="mb-1.5 font-medium text-foreground">
                {index + 1}. {t(`gettingStarted.steps.${step}.title`)}
              </h4>
              <p className="text-sm text-muted-foreground">{t(`gettingStarted.steps.${step}.description`)}</p>

              {step === 'createPRD' && (
                <Button
                  variant="tonal"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    onCreatePrd();
                    onClose();
                  }}
                >
                  {t('buttons.addPRD')}
                </Button>
              )}
            </div>
          ))}

          <div className="rounded-xl border border-border bg-secondary p-4">
            <h4 className="mb-2 font-medium text-foreground">{t('helpGuide.proTips.title')}</h4>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {PRO_TIPS.map((tip) => (
                <li key={tip}>{t(`helpGuide.proTips.${tip}`)}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h4 className="mb-2 font-medium text-foreground">{t('helpGuide.learnMore.title')}</h4>
            <p className="mb-3 text-sm text-muted-foreground">{t('helpGuide.learnMore.description')}</p>
            <a
              href="https://github.com/eyaltoledano/claude-task-master"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-primary underline underline-offset-4"
            >
              {t('helpGuide.learnMore.githubButton')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
