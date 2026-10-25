import { ArrowUpCircle } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ClaudeUpdateFooterRow } from '@/modules/claude-updates';
import { Banner } from '@/shared/ui';
import type { ReleaseInfo } from '@/shared/types';

type SidebarFooterProps = {
  updateAvailable: boolean;
  restartRequired: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  onShowVersionModal: () => void;
  onShowUpdates: () => void;
  t: TFunction;
};

/** Rendered by SidebarContent at the bottom of the panel for the restart-required and update banners. */
export default function SidebarFooter({
  updateAvailable,
  restartRequired,
  releaseInfo,
  latestVersion,
  onShowVersionModal,
  onShowUpdates,
  t,
}: SidebarFooterProps) {
  const updateTitle = releaseInfo?.title || `v${latestVersion}`;

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

      {/* Claude's own row, directly above the app's: two things can have an update, and the one
          that is about Claude says Claude. Renders nothing when there is no offer to make. */}
      <ClaudeUpdateFooterRow onOpen={onShowUpdates} />

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
    </div>
  );
}
