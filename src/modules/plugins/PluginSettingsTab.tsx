import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BarChart3,
  BookOpen,
  Calculator,
  Clock,
  Download,
  ExternalLink,
  Github,
  GitBranch,
  Loader2,
  ListTodo,
  RefreshCw,
  ServerCrash,
  ShieldAlert,
  Terminal,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

import { usePlugins } from '@/modules/plugins/context/PluginsContext';
import { Button, Input, SettingRow, Switch } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { Plugin } from '@/shared/types';
import PluginIcon from '@/modules/plugins/PluginIcon';

const STARTER_PLUGIN_URL = 'https://github.com/cloudcli-ai/cloudcli-plugin-starter';
const TERMINAL_PLUGIN_URL = 'https://github.com/cloudcli-ai/cloudcli-plugin-terminal';
const SCHEDULED_PROMPT_PLUGIN_URL = 'https://github.com/grostim/cloudcli-cron';
const CLAUDE_WATCH_PLUGIN_URL = 'https://github.com/satsuki19980613/cloudcli-claude-watch';
const PRISM_CLOUDCLI_PLUGIN_URL = 'https://github.com/jakeefr/cloudcli-plugin-prism';
const SESSION_MANAGER_PLUGIN_URL = 'https://github.com/strykereye2/cloudcli-plugin-session-manager';
const TOKEN_COST_CALCULATOR_PLUGIN_URL = 'https://github.com/NightmareAway/cloudcli-plugin-token-cost-calculator';
const TASK_QUEUE_PLUGIN_URL = 'https://github.com/TadMSTR/cloudcli-plugin-task-queue';
const GITHUB_ISSUES_BOARD_PLUGIN_URL = 'https://github.com/szmidtpiotr/claude-github-issue';
const CLAUDE_USAGE_PLUGIN_URL = 'https://github.com/HandyS11/cloudcli-plugin-claude-usage';
const CODEX_USAGE_PLUGIN_URL = 'https://github.com/dongwook-chan/cloudcli-plugin-codex-usage';

type PluginRecommendation = {
  id: string;
  translationKey: string;
  repoUrl: string;
  installedNames: string[];
  icon: LucideIcon;
  source: 'official' | 'unofficial';
};

const OFFICIAL_PLUGIN_RECOMMENDATIONS: PluginRecommendation[] = [
  {
    id: 'project-stats',
    translationKey: 'starterPlugin',
    repoUrl: STARTER_PLUGIN_URL,
    installedNames: ['project-stats'],
    icon: BarChart3,
    source: 'official',
  },
  {
    id: 'web-terminal',
    translationKey: 'terminalPlugin',
    repoUrl: TERMINAL_PLUGIN_URL,
    installedNames: ['web-terminal'],
    icon: Terminal,
    source: 'official',
  },
];

const UNOFFICIAL_PLUGIN_RECOMMENDATIONS: PluginRecommendation[] = [
  {
    id: 'cloudcli-claude-watch',
    translationKey: 'claudeWatchPlugin',
    repoUrl: CLAUDE_WATCH_PLUGIN_URL,
    installedNames: ['cloudcli-claude-watch'],
    icon: Activity,
    source: 'unofficial',
  },
  {
    id: 'workspace-scheduled-prompts',
    translationKey: 'scheduledPromptPlugin',
    repoUrl: SCHEDULED_PROMPT_PLUGIN_URL,
    installedNames: ['workspace-scheduled-prompts'],
    icon: Clock,
    source: 'unofficial',
  },
  {
    id: 'prism',
    translationKey: 'prismCloudCLI',
    repoUrl: PRISM_CLOUDCLI_PLUGIN_URL,
    installedNames: ['prism'],
    icon: Activity,
    source: 'unofficial',
  },
  {
    id: 'session-manager',
    translationKey: 'sessionManagerPlugin',
    repoUrl: SESSION_MANAGER_PLUGIN_URL,
    installedNames: ['session-manager'],
    icon: Activity,
    source: 'unofficial',
  },
  {
    id: 'token-cost-calculator',
    translationKey: 'tokenCostCalculatorPlugin',
    repoUrl: TOKEN_COST_CALCULATOR_PLUGIN_URL,
    installedNames: ['token-cost-calculator'],
    icon: Calculator,
    source: 'unofficial',
  },
  {
    id: 'task-queue',
    translationKey: 'taskQueuePlugin',
    repoUrl: TASK_QUEUE_PLUGIN_URL,
    installedNames: ['task-queue'],
    icon: ListTodo,
    source: 'unofficial',
  },
  {
    id: 'claude-github-issue',
    translationKey: 'githubIssuesBoardPlugin',
    repoUrl: GITHUB_ISSUES_BOARD_PLUGIN_URL,
    installedNames: ['claude-github-issue'],
    icon: Github,
    source: 'unofficial',
  },
  {
    id: 'claude-usage',
    translationKey: 'claudeUsagePlugin',
    repoUrl: CLAUDE_USAGE_PLUGIN_URL,
    installedNames: ['claude-usage'],
    icon: BarChart3,
    source: 'unofficial',
  },
  {
    id: 'codex-usage',
    translationKey: 'codexUsagePlugin',
    repoUrl: CODEX_USAGE_PLUGIN_URL,
    installedNames: ['codex-usage'],
    icon: BarChart3,
    source: 'unofficial',
  },
];

function repoSlug(repoUrl: string) {
  return repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, '');
}

function normalizeRepoUrl(repoUrl: string | null) {
  return repoUrl?.replace(/\.git$/, '').replace(/\/$/, '').toLowerCase() ?? null;
}

function pluginMatchesRecommendation(plugin: Plugin, recommendation: PluginRecommendation) {
  return (
    recommendation.installedNames.includes(plugin.name)
    || normalizeRepoUrl(plugin.repoUrl) === normalizeRepoUrl(recommendation.repoUrl)
  );
}

/* ─── Server Dot ────────────────────────────────────────────────────────── */
function ServerDot({ running, t }: { running: boolean; t: any }) {
  if (!running) return null;
  return (
    <span className="relative flex items-center gap-1.5">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--pos-dot)] opacity-75 motion-safe:animate-ping" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--pos-dot)]" />
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--pos-ink)]">
        {t('pluginSettings.runningStatus')}
      </span>
    </span>
  );
}

/* ─── Plugin Card ───────────────────────────────────────────────────────── */
type PluginCardProps = {
  plugin: Plugin;
  index: number;
  onToggle: (enabled: boolean) => void;
  onUpdate: () => void;
  onUninstall: () => void;
  updating: boolean;
  confirmingUninstall: boolean;
  onCancelUninstall: () => void;
  updateError: string | null;
};

function PluginCard({
  plugin,
  index,
  onToggle,
  onUpdate,
  onUninstall,
  updating,
  confirmingUninstall,
  onCancelUninstall,
  updateError,
}: PluginCardProps) {
  const { t } = useTranslation('settings');
  const accentColor = plugin.enabled
    ? 'bg-[var(--pos-dot)]'
    : 'bg-muted-foreground/20';

  return (
    <div
      className="relative flex overflow-hidden border-b border-border transition-opacity duration-200"
      style={{
        opacity: plugin.enabled ? 1 : 0.65,
        animationDelay: `${index * 40}ms`,
      }}
    >
      {/* Left accent bar */}
      <div className={`w-[3px] flex-shrink-0 ${accentColor} transition-colors duration-300`} />

      {/* The card's own chrome ends at the accent bar; the row inside is the kit's, so the actions
          sit beside the text only while a 10rem text column fits next to them and drop below it on
          a phone, instead of squeezing the name, the byline and the repo slug into a sliver. */}
      <div className="min-w-0 flex-1">
        <SettingRow
          icon={(
            <div className="h-5 w-5 flex-shrink-0 text-foreground/80">
              <PluginIcon
                pluginName={plugin.name}
                iconFile={plugin.icon}
                className="h-5 w-5 [&>svg]:h-full [&>svg]:w-full"
              />
            </div>
          )}
          label={(
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">{plugin.displayName}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                v{plugin.version}
              </span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                {plugin.slot}
              </span>
              <ServerDot running={!!plugin.serverRunning} t={t} />
            </span>
          )}
          description={(
            <div className="space-y-1">
              {plugin.description && (
                <p className="text-sm leading-snug">{plugin.description}</p>
              )}
              {(plugin.author || plugin.repoUrl) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground/60">
                  {plugin.author && <span>{plugin.author}</span>}
                  {plugin.repoUrl && (
                    <a
                      href={plugin.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-start gap-1 transition-colors hover:text-foreground"
                    >
                      <GitBranch className="mt-0.5 h-3 w-3 flex-shrink-0" />
                      <span className="min-w-0 break-all">{repoSlug(plugin.repoUrl)}</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        >
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 finger:size-11"
              onClick={onUpdate}
              disabled={updating || !plugin.repoUrl}
              title={plugin.repoUrl ? t('pluginSettings.pullLatest') : t('pluginSettings.noGitRemote')}
              aria-label={t('pluginSettings.pullLatest')}
            >
              {updating ? <Loader2 aria-hidden="true" className="animate-spin" /> : <RefreshCw aria-hidden="true" />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className={cn('size-8 finger:size-11', confirmingUninstall && 'text-[var(--danger-ink)]')}
              onClick={onUninstall}
              title={confirmingUninstall ? t('pluginSettings.confirmUninstall') : t('pluginSettings.uninstallPlugin')}
              aria-label={t('pluginSettings.uninstallPlugin')}
            >
              <Trash2 aria-hidden="true" />
            </Button>

            <Switch checked={plugin.enabled} onChange={onToggle} label={`${plugin.enabled ? t('pluginSettings.disable') : t('pluginSettings.enable')} ${plugin.displayName}`} />
          </div>
        </SettingRow>

        {(confirmingUninstall || updateError) && (
          <div className="space-y-2 px-4 pb-4">
            {confirmingUninstall && (
              // Wraps: the buttons drop under the message when the two do not fit, and the message
              // breaks anywhere — a plugin's name can be one unbroken word, and the card's
              // `overflow-hidden` would cut the Remove button off behind it.
              <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--danger-soft)] px-3 py-2">
                <span className="min-w-0 text-sm text-[var(--danger-ink)] [overflow-wrap:anywhere]">
                  {t('pluginSettings.confirmUninstallMessage', { name: plugin.displayName })}
                </span>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" className="h-8 finger:h-11" onClick={onCancelUninstall}>
                    {t('pluginSettings.cancel')}
                  </Button>
                  <Button variant="destructive" size="sm" className="h-8 finger:h-11" onClick={onUninstall}>
                    {t('pluginSettings.remove')}
                  </Button>
                </div>
              </div>
            )}

            {updateError && (
              <div className="flex items-center gap-1.5 text-sm text-[var(--danger-ink)]">
                <ServerCrash className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{updateError}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Recommendation Section ────────────────────────────────────────────── */
function RecommendationSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h4 className="font-mono text-[10px] font-medium uppercase leading-[14px] tracking-[0.18em] text-muted-foreground">
          {title}
        </h4>
        <p className="mt-0.5 text-xs text-muted-foreground/70">
          {description}
        </p>
      </div>
      <div className="space-y-2">
        {children}
      </div>
    </section>
  );
}

/* ─── Plugin Recommendation Card ────────────────────────────────────────── */
function PluginRecommendationCard({
  recommendation,
  onInstall,
  disabled,
  installing,
}: {
  recommendation: PluginRecommendation;
  onInstall: () => void;
  disabled: boolean;
  installing: boolean;
}) {
  const { t } = useTranslation('settings');
  const Icon = recommendation.icon;
  const isOfficial = recommendation.source === 'official';
  const accentClass = isOfficial ? 'bg-[var(--info-dot)]' : 'bg-[var(--warn-dot)]';
  const iconClass = isOfficial ? 'text-[var(--info-ink)]' : 'text-[var(--warn-ink)]';

  return (
    <div className="relative flex overflow-hidden border-b border-border">
      <div className={`w-[3px] flex-shrink-0 ${accentClass}`} />
      <SettingRow
        className="min-w-0 flex-1"
        icon={(
          <div className={`h-5 w-5 flex-shrink-0 ${iconClass}`}>
            <Icon className="h-5 w-5" />
          </div>
        )}
        label={(
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-foreground">
              {t(`pluginSettings.${recommendation.translationKey}.name`)}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              {t('pluginSettings.tab')}
            </span>
          </span>
        )}
        description={(
          <div className="space-y-1">
            <p className="text-sm leading-snug">
              {t(`pluginSettings.${recommendation.translationKey}.description`)}
            </p>
            <a
              href={recommendation.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-start gap-1 text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <GitBranch className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span className="min-w-0 break-all">{repoSlug(recommendation.repoUrl)}</span>
            </a>
          </div>
        )}
      >
        <Button variant="outline" size="sm" className="flex-shrink-0 gap-1.5 finger:h-11" onClick={onInstall} disabled={disabled}>
          {installing ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
          {installing ? t('pluginSettings.installing') : t(`pluginSettings.${recommendation.translationKey}.install`)}
        </Button>
      </SettingRow>
    </div>
  );
}

/* ─── Main Component ────────────────────────────────────────────────────── */
/** Rendered by the settings module as its Plugins tab, for installing, updating and toggling plugins. */
export default function PluginSettingsTab() {
  const { t } = useTranslation('settings');
  const { plugins, loading, installPlugin, uninstallPlugin, updatePlugin, togglePlugin } =
    usePlugins();

  const [gitUrl, setGitUrl] = useState('');
  const [installing, setInstalling] = useState(false);
  const [installingRecommendation, setInstallingRecommendation] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const [updatingPlugins, setUpdatingPlugins] = useState<Set<string>>(new Set());
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({});

  const handleUpdate = async (name: string) => {
    setUpdatingPlugins((prev) => new Set(prev).add(name));
    setUpdateErrors((prev) => { const next = { ...prev }; delete next[name]; return next; });
    const result = await updatePlugin(name);
    if (!result.success) {
      setUpdateErrors((prev) => ({ ...prev, [name]: result.error || t('pluginSettings.updateFailed') }));
    }
    setUpdatingPlugins((prev) => { const next = new Set(prev); next.delete(name); return next; });
  };

  const handleInstall = async () => {
    if (!gitUrl.trim()) return;
    setInstalling(true);
    setInstallError(null);
    const result = await installPlugin(gitUrl.trim());
    if (result.success) {
      setGitUrl('');
    } else {
      setInstallError(result.error || t('pluginSettings.installFailed'));
    }
    setInstalling(false);
  };

  const handleInstallRecommendation = async (recommendation: PluginRecommendation) => {
    if (installingRecommendation) return;
    setInstallingRecommendation(recommendation.id);
    setInstallError(null);
    try {
      const result = await installPlugin(recommendation.repoUrl);
      if (!result.success) {
        setInstallError(result.error || t('pluginSettings.installFailed'));
      }
    } finally {
      setInstallingRecommendation(null);
    }
  };

  const handleUninstall = async (name: string) => {
    if (confirmUninstall !== name) {
      setConfirmUninstall(name);
      return;
    }
    const result = await uninstallPlugin(name);
    if (result.success) {
      setConfirmUninstall(null);
    } else {
      setInstallError(result.error || t('pluginSettings.uninstallFailed'));
      setConfirmUninstall(null);
    }
  };

  const isRecommendationInstalled = (recommendation: PluginRecommendation) => {
    return plugins.some((plugin) => pluginMatchesRecommendation(plugin, recommendation));
  };

  const isOfficialPlugin = (plugin: Plugin) => {
    return OFFICIAL_PLUGIN_RECOMMENDATIONS.some((recommendation) => (
      pluginMatchesRecommendation(plugin, recommendation)
    ));
  };

  const officialPlugins = plugins.filter(isOfficialPlugin);
  const otherPlugins = plugins.filter((plugin) => !isOfficialPlugin(plugin));
  const officialRecommendations = OFFICIAL_PLUGIN_RECOMMENDATIONS.filter(
    (recommendation) => !isRecommendationInstalled(recommendation),
  );
  const unofficialRecommendations = UNOFFICIAL_PLUGIN_RECOMMENDATIONS.filter(
    (recommendation) => !isRecommendationInstalled(recommendation),
  );
  const hasOfficialSection = officialPlugins.length > 0 || officialRecommendations.length > 0;
  const hasOtherSection = otherPlugins.length > 0 || unofficialRecommendations.length > 0;

  const renderPluginCard = (plugin: Plugin, index: number) => {
    const handleToggle = async (enabled: boolean) => {
      const r = await togglePlugin(plugin.name, enabled);
      if (!r.success) {
        setInstallError(r.error || t('pluginSettings.toggleFailed'));
      }
    };

    return (
      <PluginCard
        key={plugin.name}
        plugin={plugin}
        index={index}
        onToggle={(enabled) => void handleToggle(enabled)}
        onUpdate={() => void handleUpdate(plugin.name)}
        onUninstall={() => void handleUninstall(plugin.name)}
        updating={updatingPlugins.has(plugin.name)}
        confirmingUninstall={confirmUninstall === plugin.name}
        onCancelUninstall={() => setConfirmUninstall(null)}
        updateError={updateErrors[plugin.name] ?? null}
      />
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="mb-1 text-base font-semibold text-foreground">
          {t('pluginSettings.title')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('pluginSettings.description')}
        </p>
      </div>

      {/* Install from Git — compact. The input is `min-w-0`: a text input's own minimum width (218–265px)
          otherwise pushes the button past the form's `overflow-hidden` edge on a phone, and cuts it. */}
      <div className="flex items-center gap-2">
        <Input
          type="text"
          value={gitUrl}
          onChange={(e) => {
            setGitUrl(e.target.value);
            setInstallError(null);
          }}
          placeholder={t('pluginSettings.installPlaceholder')}
          aria-label={t('pluginSettings.installAriaLabel')}
          className="min-w-0 flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleInstall();
          }}
        />
        <Button className="flex-shrink-0" onClick={handleInstall} disabled={installing || !gitUrl.trim()}>
          {installing ? <Loader2 aria-hidden="true" className="animate-spin" /> : t('pluginSettings.installButton')}
        </Button>
      </div>

      {installError && (
        <p className="-mt-4 text-sm text-[var(--danger-ink)]">{installError}</p>
      )}

      <p className="-mt-4 flex items-start gap-1.5 text-xs leading-snug text-muted-foreground/50">
        <ShieldAlert className="mt-px h-3 w-3 flex-shrink-0" />
        <span>
          {t('pluginSettings.securityWarning')}
        </span>
      </p>

      {/* Plugin sections */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('pluginSettings.scanningPlugins')}
        </div>
      ) : (
        <div className="space-y-4">
          {hasOfficialSection && (
            <RecommendationSection
              title={t('pluginSettings.sections.officialTitle')}
              description={t('pluginSettings.sections.officialDescription')}
            >
              {officialPlugins.map((plugin, index) => renderPluginCard(plugin, index))}
              {officialRecommendations.map((recommendation) => (
                <PluginRecommendationCard
                  key={recommendation.id}
                  recommendation={recommendation}
                  onInstall={() => void handleInstallRecommendation(recommendation)}
                  disabled={!!installingRecommendation}
                  installing={installingRecommendation === recommendation.id}
                />
              ))}
            </RecommendationSection>
          )}

          {hasOtherSection && (
            <RecommendationSection
              title={t('pluginSettings.sections.unofficialTitle')}
              description={t('pluginSettings.sections.unofficialDescription')}
            >
              {otherPlugins.map((plugin, index) => renderPluginCard(plugin, officialPlugins.length + index))}
              {unofficialRecommendations.map((recommendation) => (
                <PluginRecommendationCard
                  key={recommendation.id}
                  recommendation={recommendation}
                  onInstall={() => void handleInstallRecommendation(recommendation)}
                  disabled={!!installingRecommendation}
                  installing={installingRecommendation === recommendation.id}
                />
              ))}
            </RecommendationSection>
          )}
        </div>
      )}

      {/* Starter plugin */}
      <div className="flex items-center justify-center gap-3 border-t border-border/50 pt-2">
        <BookOpen className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40" />
        <span className="text-xs text-muted-foreground/60">
          {t('pluginSettings.starterPluginLabel')}
        </span>
        <span className="text-muted-foreground/20">·</span>
        <a
          href={STARTER_PLUGIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          {t('pluginSettings.starter')} <ExternalLink className="h-2.5 w-2.5" />
        </a>
        <span className="text-muted-foreground/20">·</span>
        <a
          href="https://cloudcli.ai/docs/plugin-overview"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          {t('pluginSettings.docs')} <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );
}
