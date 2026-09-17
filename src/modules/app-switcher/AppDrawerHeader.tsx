import { X } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';
import { Button, DialogTitle } from '@/shared/ui';

type AppDrawerHeaderProps = {
  /** The sheet's own label, `aria-labelledby` on the dialog and the heading's id alike. */
  titleId: string;
  /** Takes the sheet away and leaves the panes standing — the drawer owns what else an exit clears. */
  onDismiss: () => void;
};

/**
 * The sheet's top — what this is, how to leave it, and how much is on file: the drawer's first three
 * questions, in the order they are asked.
 *
 * Close and Close all are different acts, so they are never the same control. The round ✕ takes the
 * sheet away and leaves the panes standing; Close all, on the count line and only while something is
 * up, takes every application down and returns the reader to the workspace.
 *
 * Extracted from the drawer at the 300-line ceiling, which is also the cut the file wanted: the
 * count line's two readings of the registry are the header's own, and the list below only asks
 * whether the first read has landed.
 */
export function AppDrawerHeader({ titleId, onDismiss }: AppDrawerHeaderProps) {
  const { t } = useTranslation();
  const { apps, registryError, registryRead, panes, dual, close, setDrawerOpen } = useAppSwitcher();

  // Every pane down, the sheet with them: back to the workspace.
  function handleCloseApplications() {
    close();
    setDrawerOpen(false);
  }

  // A list that has not answered yet is not an empty one, and a failed read is not an empty registry
  // either — the Banner below says what happened, and a count would be a claim nobody measured.
  const listUnknown = !registryRead || (apps.length === 0 && registryError !== null);
  const summary = listUnknown
    ? null
    : apps.length === 0
      ? t('applications.summaryNone')
      : t(dual ? 'applications.summaryDual' : 'applications.summarySingle', { count: apps.length });
  const nothingOnScreen = panes.left.appId === null && panes.right.appId === null;

  return (
    <header className="flex shrink-0 flex-col gap-1 px-[22px] pb-4 pt-[calc(env(safe-area-inset-top)+26px)]">
      <div className="flex items-start justify-between gap-3">
        <DialogTitle
          id={titleId}
          className="not-sr-only min-w-0 font-serif text-[30px] font-normal leading-[1.1] text-foreground"
        >
          <Trans i18nKey="applications.heading" components={{ em: <i className="text-accent-ink" /> }} />
        </DialogTitle>
        <Button
          variant="outline"
          size="icon"
          aria-label={t('applications.closeDrawer')}
          className="h-9 w-9 flex-none rounded-full border border-border bg-card text-muted-foreground hover:text-accent-ink"
          onClick={onDismiss}
        >
          <X />
        </Button>
      </div>
      {/* The count line holds its height when it is empty, so the sheet never jumps as it reads. */}
      <div className="flex min-h-[20px] items-center justify-between gap-3">
        {summary !== null && (
          <p className="truncate text-xs uppercase tracking-[0.14em] text-ink-faint">{summary}</p>
        )}
        {!nothingOnScreen && (
          <Button
            variant="link"
            className="ml-auto h-auto p-0 text-xs uppercase tracking-[0.14em] text-accent-ink"
            onClick={handleCloseApplications}
          >
            {t('applications.close')}
          </Button>
        )}
      </div>
    </header>
  );
}
