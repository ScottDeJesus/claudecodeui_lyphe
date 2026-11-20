import { Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type WorkspaceStateViewProps = {
  mode: 'loading' | 'empty';
};

/**
 * Rendered by WorkspaceMain in two places:
 * - as the whole screen (`mode="loading"`) while projects load;
 * - as the choose-a-project body (`mode="empty"`) inside a pane that reads the open project — Chat, Shell, Tasks and a plugin's —
 *   when none is selected, under the pane's own head. A project is chosen by opening one of its chats from the sessions home, and a
 *   folder is made a project from the menu's New project (the old sidebar that did both is no longer drawn).
 */
export default function WorkspaceStateView({ mode }: WorkspaceStateViewProps) {
  const { t } = useTranslation();

  const isLoading = mode === 'loading';

  return (
    <div className="flex h-full flex-col">
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-muted-foreground">
            <div className="mx-auto mb-4 h-10 w-10">
              <div
                className="h-full w-full rounded-full border-[3px] border-muted border-t-primary"
                style={{
                  animation: 'spin 1s linear infinite',
                  WebkitAnimation: 'spin 1s linear infinite',
                  MozAnimation: 'spin 1s linear infinite',
                }}
              />
            </div>
            <h2 className="mb-1 text-lg font-semibold text-foreground">{t('mainContent.loading')}</h2>
            <p className="text-sm">{t('mainContent.settingUpWorkspace')}</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="mx-auto max-w-md px-6 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
              <Folder className="h-7 w-7 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-foreground">{t('mainContent.chooseProject')}</h2>
            <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{t('mainContent.selectProjectDescription')}</p>
            <div className="rounded-xl border border-primary/10 bg-primary/5 p-3.5">
              {/* A green WORD takes the readable ink: `text-primary` is the accent FILL and
                  measures 2.5:1 on this wash. The pair is explained at tailwind.config.js:69. */}
              <p className="text-sm text-accent-ink">
                <strong>{t('mainContent.tip')}:</strong> {t('mainContent.newProjectTip')}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
