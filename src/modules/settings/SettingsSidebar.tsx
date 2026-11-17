import { Bell, Bot, Download, GitBranch, Info, Key, ListChecks, Mic, MonitorPlay, Palette, Puzzle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import { Chip } from '@/shared/ui';
import type { SettingsMainTab } from '@/shared/types';

type SettingsSidebarProps = {
  activeTab: SettingsMainTab;
  onChange: (tab: SettingsMainTab) => void;
};

type NavItem = {
  id: SettingsMainTab;
  labelKey: string;
  icon: typeof Bot;
};

/**
 * The prototype's order: Agents, Appearance, Git,
 * Tasks, Notifications, Keys and credentials, Voice, Plugins, About.
 *
 * Browser has no row in the prototype — the design predates the tab — so it sits with the
 * other optional integrations, after Plugins, and About stays last as it does there.
 *
 * Updates has no row in the prototype either, and sits immediately before About: it is about the
 * application itself rather than about how it behaves, which is where About already is.
 */
const NAV_ITEMS: NavItem[] = [
  { id: 'agents', labelKey: 'mainTabs.agents', icon: Bot },
  { id: 'appearance', labelKey: 'mainTabs.appearance', icon: Palette },
  { id: 'git', labelKey: 'mainTabs.git', icon: GitBranch },
  { id: 'tasks', labelKey: 'mainTabs.tasks', icon: ListChecks },
  { id: 'notifications', labelKey: 'mainTabs.notifications', icon: Bell },
  { id: 'api', labelKey: 'mainTabs.apiTokens', icon: Key },
  { id: 'voice', labelKey: 'mainTabs.voice', icon: Mic },
  { id: 'plugins', labelKey: 'mainTabs.plugins', icon: Puzzle },
  { id: 'browser', labelKey: 'mainTabs.browser', icon: MonitorPlay },
  { id: 'updates', labelKey: 'mainTabs.updates', icon: Download },
  { id: 'about', labelKey: 'mainTabs.about', icon: Info },
];

/** Rendered by Settings to switch between the settings dialog's main sections. */
export default function SettingsSidebar({ activeTab, onChange }: SettingsSidebarProps) {
  const { t } = useTranslation('settings');

  return (
    <>
      {/* Desktop rail. Stays a real <button> per row: it is the settings dialog's only
          keyboard-reachable navigation, and the verification harness drives Settings by
          clicking these rows' English labels. */}
      <aside className="hidden w-48 flex-shrink-0 border-r border-border md:flex md:flex-col">
        <nav className="flex flex-col gap-0.5 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onChange(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  // No wash and no corners: the row you are on is the strong ink with the accent's mark at its start, the
                  // others are the muted ink until pointed at. Nothing moves.
                  'flex items-center gap-3 whitespace-nowrap border-l-2 px-3 py-2.5 text-left text-sm',
                  isActive
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {t(item.labelKey)}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile rail — the same list as a scrolling row of Verve chips. */}
      <div className="scrollbar-hide flex flex-shrink-0 gap-1.5 overflow-x-auto border-b border-border px-3 py-2.5 md:hidden">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;

          return (
            <span key={item.id} className="flex-shrink-0">
              <Chip selected={activeTab === item.id} onClick={() => onChange(item.id)} size="sm">
                <Icon className="h-3.5 w-3.5" />
                {t(item.labelKey)}
              </Chip>
            </span>
          );
        })}
      </div>
    </>
  );
}
