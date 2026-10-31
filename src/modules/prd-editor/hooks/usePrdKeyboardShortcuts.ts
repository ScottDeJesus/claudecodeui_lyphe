import { useEffect } from 'react';

import { useIsPageHeld } from '@/shared/context/HeldPageContext';

type UsePrdKeyboardShortcutsArgs = {
  onSave: () => void;
  onClose: () => void;
};

export function usePrdKeyboardShortcuts({
  onSave,
  onClose,
}: UsePrdKeyboardShortcutsArgs): void {
  const isPageHeld = useIsPageHeld();
  useEffect(() => {
    // Keep shortcuts global so the editor behaves consistently in fullscreen and modal mode.
    const handleKeyDown = (event: KeyboardEvent) => {
      // The station on screen covers the page this editor is on: its keys are not the editor's.
      if (isPageHeld()) return;
      const loweredKey = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && loweredKey === 's') {
        event.preventDefault();
        onSave();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPageHeld, onClose, onSave]);
}
