import { ArrowUpCircle, Settings } from 'lucide-react';
import type { TFunction } from 'i18next';

import { AccountFooterRow } from '@/modules/accounts';
import { Banner } from '@/shared/ui';
import type { ReleaseInfo } from '@/shared/types';

type SidebarFooterProps = {
  updateAvailable: boolean;
  restartRequired: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  t: TFunction;
};

/** Rendered by SidebarContent at the bottom of the panel for the account row, update status and Settings. */
export default function SidebarFooter({
  updateAvailable,
  restartRequired,
  releaseInfo,
  latestVersion,
  onShowVersionModal,
  onShowSettings,
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

      <div className="nav-divider" />

      {/* Desktop */}
      <div className="hidden px-2 py-1.5 md:block">
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={onShowSettings}
        >
          <Settings aria-hidden="true" className="h-4 w-4 flex-none" />
          <span className="truncate text-sm">{t('actions.settings')}</span>
        </button>
      </div>

      {/* Mobile: the same action, at thumb size. */}
      <div className="px-3 pb-3 pt-3 md:hidden">
        <button
          className="flex h-10 w-full items-center gap-3 rounded-xl bg-muted/40 px-3.5 transition-all hover:bg-muted/60 active:scale-[0.98]"
          onClick={onShowSettings}
        >
          <Settings aria-hidden="true" className="h-4 w-4 flex-none text-muted-foreground" />
          <span className="truncate text-sm font-normal text-foreground">{t('actions.settings')}</span>
        </button>
      </div>
    </div>
  );
}
