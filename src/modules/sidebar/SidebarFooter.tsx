import { ArrowUpCircle, Bug } from 'lucide-react';
import type { TFunction } from 'i18next';

import { AccountFooterRow } from '@/modules/accounts';
import { useCliVersion } from '@/shared/hooks/useCliVersion';
import { Banner } from '@/shared/ui';
import { IS_PLATFORM } from '@/shared/utils';
import type { ReleaseInfo } from '@/shared/types';

const GITHUB_ISSUES_URL = 'https://github.com/siteboon/claudecodeui/issues/new';
const GITHUB_REPO_URL = 'https://github.com/siteboon/claudecodeui';

const DISCORD_INVITE_URL = 'https://discord.gg/buxwujPNRE';

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

/**
 * The footer's one sentence about the Claude CLI: what is installed, and how many live
 * conversations are still running something else.
 *
 * Three states, three sentences, and the difference between them is the point. `installed` is a
 * version once it has been read. It is null with a `reason` when the route looked and could not
 * say — a bare `claude` resolved only when a run starts, a binary that would not answer — and the
 * route's own words are used, never a stand-in `0.0.0` and never one explanation standing in for
 * another. It is null with NO reason before the first answer has landed, and then the line says
 * only that the version is not known: nothing has been read, so nothing may be explained.
 *
 * When several stale runs disagree about their version the line counts them rather than naming
 * one, because naming one would be false about the rest.
 */
function cliVersionFactLine(installed: string | null, reason: string | null, staleVersions: string[]): string {
  const installedFact = installed
    ? `Claude CLI ${installed} is installed`
    : `Claude CLI version —${reason ? ` ${reason}` : ''}`;
  if (staleVersions.length === 0) return installedFact;

  const counted = staleVersions.length === 1
    ? '1 conversation still runs'
    : `${staleVersions.length} conversations still run`;
  const distinct = [...new Set(staleVersions)];
  return `${installedFact} · ${counted} ${distinct.length === 1 ? distinct[0] : 'other versions'}`;
}

type SidebarFooterProps = {
  updateAvailable: boolean;
  restartRequired: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  currentVersion: string;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  t: TFunction;
};

/** Rendered by SidebarContent at the bottom of the panel for settings, update status and community links. */
export default function SidebarFooter({
  updateAvailable,
  restartRequired,
  releaseInfo,
  latestVersion,
  currentVersion,
  onShowVersionModal,
  onShowSettings,
  t,
}: SidebarFooterProps) {
  const updateTitle = releaseInfo?.title || `v${latestVersion}`;

  const { installed: installedCliVersion, reason: cliVersionReason, staleSessionIds, staleVersionOf } = useCliVersion();
  const staleCliVersions = [...staleSessionIds]
    .map(staleVersionOf)
    .filter((version): version is string => version !== null);

  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* Restart-required: the running server version differs from the installed/frontend one
          (updated but not restarted). A Banner, so the ▲ carries the state as well as the fill. */}
      {restartRequired && (
        <>
          <div className="nav-divider" />
          <div className="px-2 py-1.5">
            <Banner tone="warn">
              <span className="text-xs font-medium">{t('version.restartRequired')}</span>
            </Banner>
          </div>
        </>
      )}

      {/* Update banner */}
      {updateAvailable && (
        <>
          <div className="nav-divider" />
          {/* Desktop update */}
          <div className="hidden px-2 py-1.5 md:block">
            <button
              className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-primary/10"
              onClick={onShowVersionModal}
            >
              <div className="relative flex-shrink-0">
                <ArrowUpCircle className="h-4 w-4 text-primary" />
                <span className="vv-pulse absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-normal text-accent-ink">{updateTitle}</span>
                <span className="text-[10px] text-muted-foreground">{t('version.updateAvailable')}</span>
              </div>
            </button>
          </div>

          {/* Mobile update */}
          <div className="px-3 py-2 md:hidden">
            <button
              className="flex h-11 w-full items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3.5 transition-all active:scale-[0.98]"
              onClick={onShowVersionModal}
            >
              <div className="relative flex-shrink-0">
                <ArrowUpCircle className="h-4 w-4 text-primary" />
                <span className="vv-pulse absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-normal text-accent-ink">{updateTitle}</span>
                <span className="text-xs text-muted-foreground">{t('version.updateAvailable')}</span>
              </div>
            </button>
          </div>
        </>
      )}

      <div className="nav-divider" />

      {/* The signed-in account, above Settings in both layouts — ONE instance carrying its own
          responsive sizing, not one per block: two mounts would mean two Descent pollers, and
          D7 caps how often that read may happen. */}
      <div className="px-3 py-2 md:px-2 md:py-1.5">
        <AccountFooterRow />
      </div>

      {/* The CLI fact, stated and nothing more: acting on a conversation belongs to that
          conversation's own banner, where the sentence explaining it stands beside the button. */}
      <div className="px-3 pb-2 md:px-2 md:pb-1.5" data-cli-version-fact>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {cliVersionFactLine(installedCliVersion, cliVersionReason, staleCliVersions)}
        </p>
      </div>

      <div className="nav-divider" />

      {/* Desktop: the Settings row is the one the eye lands on, so it keeps its words; Report
          Issue and Community are the errands beside it and shrink to icons that name themselves
          on hover and to a screen reader. */}
      <div className="hidden items-center gap-1 px-2 py-1.5 md:flex">
        <button
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={onShowSettings}
        >
          <span aria-hidden="true" className="text-xs leading-none text-primary">✦</span>
          <span className="truncate text-sm">{t('actions.settings')}</span>
        </button>
        <a
          href={GITHUB_ISSUES_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('actions.reportIssue')}
          title={t('actions.reportIssue')}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Bug className="h-3.5 w-3.5" />
        </a>
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('actions.joinCommunity')}
          title={t('actions.joinCommunity')}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <DiscordIcon className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* Desktop version line (OSS mode only) */}
      {!IS_PLATFORM && (
        <div className="hidden px-3 pb-2 text-center md:block">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-ink-faint transition-colors hover:text-muted-foreground"
          >
            v{currentVersion} · {t('branding.openSource')}
          </a>
        </div>
      )}

      {/* Mobile: the same three actions, at thumb size. */}
      <div className="flex items-center gap-2 px-3 pb-3 pt-3 md:hidden">
        <button
          className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-xl bg-muted/40 px-3.5 transition-all hover:bg-muted/60 active:scale-[0.98]"
          onClick={onShowSettings}
        >
          <span aria-hidden="true" className="text-xs leading-none text-primary">✦</span>
          <span className="truncate text-sm font-normal text-foreground">{t('actions.settings')}</span>
        </button>
        <a
          href={GITHUB_ISSUES_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('actions.reportIssue')}
          title={t('actions.reportIssue')}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-muted/40 transition-all active:scale-[0.98]"
        >
          <Bug className="h-4 w-4 text-muted-foreground" />
        </a>
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('actions.joinCommunity')}
          title={t('actions.joinCommunity')}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-muted/40 transition-all active:scale-[0.98]"
        >
          <DiscordIcon className="h-4 w-4 text-muted-foreground" />
        </a>
      </div>

      {!IS_PLATFORM && (
        <div className="px-3 pb-3 text-center md:hidden">
          <span className="text-[11px] text-ink-faint">v{currentVersion}</span>
        </div>
      )}
    </div>
  );
}
