import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import { Button, EmptyState } from '@/shared/ui';
import type { PrdFile } from '@/shared/types';

type TaskEmptyStateProps = {
  className?: string;
  hasTaskMasterDirectory: boolean;
  existingPrds: PrdFile[];
  onOpenSetupModal: () => void;
  onCreatePrd: () => void;
  onOpenPrd: (prd: PrdFile) => void;
};

const SETUP_POINTS = [
  'notConfigured.features.aiPowered',
  'notConfigured.features.prdTemplates',
  'notConfigured.features.dependencyTracking',
  'notConfigured.features.progressVisualization',
  'notConfigured.features.cliIntegration',
];

const GETTING_STARTED_STEPS = ['createPRD', 'generateTasks', 'analyzeTasks', 'startBuilding'];

/** Rendered by TaskBoard when the project has no tasks, offering the TaskMaster setup and PRD entry points. */
export default function TaskEmptyState({
  className = '',
  hasTaskMasterDirectory,
  existingPrds,
  onOpenSetupModal,
  onCreatePrd,
  onOpenPrd,
}: TaskEmptyStateProps) {
  const { t } = useTranslation('tasks');

  if (!hasTaskMasterDirectory) {
    return (
      <div className={cn('flex flex-col items-center gap-6 py-12', className)}>
        <EmptyState
          title={t('notConfigured.title')}
          message={t('notConfigured.description')}
          actionLabel={t('notConfigured.initializeButton')}
          onAction={onOpenSetupModal}
        />

        <div className="max-w-md space-y-1.5 text-sm text-muted-foreground">
          <h3 className="font-medium text-foreground">{t('notConfigured.whatIsTitle')}</h3>
          {SETUP_POINTS.map((point) => (
            <p key={point}>{t(point)}</p>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('py-12', className)}>
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t('gettingStarted.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('gettingStarted.subtitle')}</p>
        </div>

        <div className="space-y-3">
          {GETTING_STARTED_STEPS.map((step, index) => (
            <div key={step} className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-1 font-medium text-foreground">
                {index + 1}. {t(`gettingStarted.steps.${step}.title`)}
              </h3>
              <p className="text-sm text-muted-foreground">{t(`gettingStarted.steps.${step}.description`)}</p>

              {step === 'createPRD' && (
                <>
                  <Button variant="tonal" size="sm" className="mt-3" onClick={onCreatePrd}>
                    {t('gettingStarted.steps.createPRD.addButton')}
                  </Button>

                  {existingPrds.length > 0 && (
                    <div className="mt-3 border-t border-border pt-3">
                      <p className="mb-2 text-xs text-ink-faint">{t('gettingStarted.steps.createPRD.existingPRDs')}</p>
                      <div className="flex flex-wrap gap-2">
                        {existingPrds.map((prd) => (
                          <Button key={prd.name} variant="outline" size="sm" onClick={() => onOpenPrd(prd)}>
                            {prd.name}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        <p className="text-sm text-ink-faint">{t('gettingStarted.tip')}</p>
      </div>
    </div>
  );
}
