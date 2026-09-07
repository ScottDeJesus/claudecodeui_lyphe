import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { LLMProviderLogo } from '@/shared/ui';
import type { AppTab, Project, ProjectSession } from '@/shared/types';
import { usePlugins } from '@/modules/plugins';
import { getSessionTitle } from '@/shared/utils';
import { LLM_PROVIDER_LABELS } from '@/shared/constants';

type WorkspaceTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
};

function getTabTitle(activeTab: AppTab, shouldShowTasksTab: boolean, t: (key: string) => string, pluginDisplayName?: string) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  if (activeTab === 'browser') {
    return t('tabs.browser');
  }

  return 'Project';
}

/**
 * The line under the title: `cloudcli-ui · Claude · last active 09:14`.
 *
 * The clock time names LAST ACTIVITY, not a start, because last activity is the only session
 * timestamp this app has. A session object off `/api/projects` carries exactly five keys —
 * `id, lastActivity, messageCount, provider, summary` — so a "started" segment could only ever
 * have been either blank or a guess dressed as a fact.
 *
 * Every part but the project is optional, and a missing one is DROPPED rather than shown as a
 * blank or a dash: a separator with nothing after it reads as a value that failed to load. A
 * timestamp the browser cannot parse counts as missing for the same reason.
 */
function getSessionSubLine(
  projectName: string,
  session: ProjectSession | null,
  t: TFunction,
): string {
  const parts = [projectName];

  const provider = session?.__provider ?? session?.provider;
  if (provider && LLM_PROVIDER_LABELS[provider]) parts.push(LLM_PROVIDER_LABELS[provider]);

  const lastActiveAt = session?.lastActivity ?? session?.updated_at;
  if (typeof lastActiveAt === 'string' && lastActiveAt) {
    const lastActive = new Date(lastActiveAt);
    if (!Number.isNaN(lastActive.getTime())) {
      parts.push(t('mainContent.lastActiveAt', {
        defaultValue: 'last active {{time}}',
        time: lastActive.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));
    }
  }

  return parts.join(' · ');
}

/** Rendered by WorkspaceHeader to label the workspace with the active session or tab name. */
export default function WorkspaceTitle({
  activeTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
}: WorkspaceTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const pluginDisplayName = activeTab.startsWith('plugin:')
    ? plugins.find((p) => p.name === activeTab.replace('plugin:', ''))?.displayName
    : undefined;

  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;

  return (
    <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {showSessionIcon && (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <LLMProviderLogo provider={selectedSession?.__provider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {activeTab === 'chat' && selectedSession ? (
          <div className="min-w-0">
            <h2 title={getSessionTitle(selectedSession)} className="truncate text-sm font-medium leading-tight text-foreground">
              {getSessionTitle(selectedSession)}
            </h2>
            <div className="truncate text-xs leading-tight text-muted-foreground">
              {getSessionSubLine(selectedProject.displayName, selectedSession, t)}
            </div>
          </div>
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <h2 className="text-base font-medium leading-tight text-foreground">{t('mainContent.newSession')}</h2>
            <div className="truncate text-xs leading-tight text-muted-foreground">
              {getSessionSubLine(selectedProject.displayName, null, t)}
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-sm font-medium leading-tight text-foreground">
              {getTabTitle(activeTab, shouldShowTasksTab, t, pluginDisplayName)}
            </h2>
            <div className="truncate text-xs leading-tight text-muted-foreground">
              {getSessionSubLine(selectedProject.displayName, selectedSession, t)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
