import { useEffect } from 'react';

/**
 * Sends focus back to where it was when a dialog mounted, once the dialog is gone.
 *
 * For a dialog that is open for as long as it is MOUNTED — its opener mounts it only while the
 * question is asked. Such a dialog never sees `open` turn false, so `DialogContent` never restores
 * focus itself, and closing it dropped focus to `<body>`. At mount, focus is on whatever opened it: a
 * row, or the `⋯` trigger, which `ActionMenu` hands focus back to in an effect that runs earlier in
 * the same commit when the menu comes before the dialog in the tree. A trigger that has since left
 * with its row is skipped.
 *
 * Used by the dispatcher module (`DeletePlanDialog`) and the roadmap module's dialogs (`ItemDialog`,
 * `FeatureDialog`, `MoveDialog`, `BlockDialog`, `DeleteDialog`, `PromoteDialog`).
 */
export function useReturnFocus(): void {
  useEffect(() => {
    const origin = document.activeElement;
    return () => {
      if (origin instanceof HTMLElement && origin.isConnected) origin.focus();
    };
  }, []);
}
