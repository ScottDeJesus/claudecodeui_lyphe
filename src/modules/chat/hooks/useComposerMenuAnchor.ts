import { useCallback, useEffect, useRef, useState } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import type { ComposerMenuAnchor } from '@/shared/types';

const VIEWPORT_MARGIN = 8;
const MENU_GAP = 8;
/** `min-w-48` on the composer panels — the narrowest they are ever drawn. */
const MIN_MENU_WIDTH = 192;

/**
 * Positions a composer popover above its trigger and right-aligned to it.
 *
 * Anchoring with `right`/`bottom` rather than `left`/`top` lets the menu grow
 * upward and leftward without measuring itself first, so it never paints in the
 * wrong spot for a frame. The same anchor works on phones because `maxWidth`
 * shrinks the menu instead of letting it run off the left edge.
 *
 * `getExternalTrigger` is for a menu whose opener is not its own button — the schedule menu
 * hangs off the SEND button, which the composer owns. It is a getter rather than a second ref
 * so that `triggerRef` below stays a plain `useRef` the compiler can still recognise; aliasing
 * the two made every `.current` read look like a dependency. Handing it in keeps one rule for
 * where a composer popover sits, and keeps the outside-pointerdown check honest: a press on the
 * trigger must not read as a press outside the menu.
 */
export function useComposerMenuAnchor(
  isOpen: boolean,
  onClose: () => void,
  preferredWidth = 320,
  getExternalTrigger?: () => HTMLElement | null,
) {
  // The menu is measured against, and listens on, the window the composer is drawn in: in a
  // picture-in-picture window the opener's viewport and keys are not the reader's.
  const hostWindow = useHostWindow();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<ComposerMenuAnchor | null>(null);

  const updateAnchor = useCallback(() => {
    const rect = (getExternalTrigger?.() ?? triggerRef.current)?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    // Capped so the menu's LEFT edge stays on screen. `right` alone is a right-edge anchor, and
    // a trigger near the left edge pushes the panel's left side off the viewport — the
    // `maxWidth` floor below (200) cannot rescue that, because a 200px-wide panel anchored 295px
    // from the right still starts at -105. Same defect MessageCopyControl carried.
    const right = Math.min(
      Math.max(VIEWPORT_MARGIN, hostWindow.innerWidth - rect.right),
      Math.max(VIEWPORT_MARGIN, hostWindow.innerWidth - MIN_MENU_WIDTH - VIEWPORT_MARGIN),
    );
    setAnchor({
      right,
      bottom: hostWindow.innerHeight - rect.top + MENU_GAP,
      maxHeight: Math.max(160, rect.top - MENU_GAP - VIEWPORT_MARGIN),
      maxWidth: Math.max(200, Math.min(preferredWidth, hostWindow.innerWidth - right - VIEWPORT_MARGIN)),
    });
  }, [preferredWidth, getExternalTrigger, hostWindow]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const trigger = getExternalTrigger?.() ?? triggerRef.current;
      if (!trigger?.contains(target) && !menuRef.current?.contains(target)) {
        onClose();
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
      (getExternalTrigger?.() ?? triggerRef.current)?.focus();
    };

    const hostDocument = hostWindow.document;
    hostDocument.addEventListener('pointerdown', handlePointerDown);
    hostWindow.addEventListener('resize', updateAnchor);
    hostWindow.addEventListener('scroll', updateAnchor, true);
    hostWindow.addEventListener('keydown', handleKeyDown, { capture: true });
    updateAnchor();

    return () => {
      hostDocument.removeEventListener('pointerdown', handlePointerDown);
      hostWindow.removeEventListener('resize', updateAnchor);
      hostWindow.removeEventListener('scroll', updateAnchor, true);
      hostWindow.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isOpen, onClose, updateAnchor, getExternalTrigger, hostWindow]);

  return { triggerRef, menuRef, anchor, updateAnchor };
}
