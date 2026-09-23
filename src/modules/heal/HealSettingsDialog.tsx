import { SettingsIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { HealControls } from '@/modules/heal/HealControls';
import type { HealSwitches, IgnoreRow } from '@/modules/heal/healTypes';
import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';

/**
 * Heal settings: the nightly cycle's schedule, the daily cap and the ignore table — `HealControls`
 * as it is, in the kit's own dialog, opened by the cog in the tab's header.
 *
 * WHY A DIALOG AND NOT THE BOTTOM OF THE SCROLL. These were the tab's last section, under every kind
 * and every heal, and the operator found them only by scrolling to the floor ("I did not know that
 * Settings was buried underneath all of that"). They are settings — set once, read rarely — so they
 * leave the triage surface for the one place a tab keeps its settings: a cog, top right.
 *
 * CONTROLLED BY THE PANEL, not by a trigger of its own: the cog opens it, and so do the two pills
 * that are statements about these rows (Ignored → the ignore table, Today → the daily cap).
 *
 * The master switch is NOT here: it is the toolbar's Start/Stop and the Settings → Agents row, and a
 * third drawing of one file is a third place to disagree.
 */
export function HealSettingsDialog({ open, onOpenChange, switches, ignore }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  switches: HealSwitches;
  ignore: IgnoreRow[];
}) {
  const { t } = useTranslation();
  const title = t('heal.settings.title', { defaultValue: 'Heal settings' });
  // EVERY CLOSE COMMITS THE FIELD UNDER THE CARET. The daily cap saves on blur, and the kit unmounts
  // the dialog's subtree on close — a removed input fires no blur, so Escape (the one dismissal that
  // moves no focus) silently dropped a typed cap while the X and the backdrop saved it. Blurring the
  // focused field before the close runs its own save path, the same one the other two already take.
  const onDialogOpenChange = (next: boolean) => {
    const focused = document.activeElement;
    if (!next && focused instanceof HTMLElement && focused.closest('[data-heal-settings]')) focused.blur();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={onDialogOpenChange}>
      <DialogContent
        aria-labelledby="heal-settings-title"
        className="flex max-h-[min(92dvh,48rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-popover p-0 shadow-2xl"
        data-heal-settings
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <SettingsIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {/* The kit's title is screen-reader-only by default; this dialog's title is also its visible heading. */}
          <DialogTitle id="heal-settings-title" className="not-sr-only text-sm font-medium text-foreground">{title}</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8 text-muted-foreground"
            onClick={() => onDialogOpenChange(false)}
            aria-label={t('heal.settings.close', { defaultValue: 'Close heal settings' })}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
          <HealControls switches={switches} ignore={ignore} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
