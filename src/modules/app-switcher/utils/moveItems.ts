import { ArrowDown, ArrowUp } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { ActionMenuItem } from '@/shared/ui';

/**
 * The kebab's Move up / Move down pair, shared by an app row and a divider: any row moves one place
 * at a time (`POST /api/apps/:id/move`). The end a row already sits at is greyed rather than hidden,
 * so the pair keeps its place in the menu.
 */
export function moveItems(
  t: TFunction,
  position: { first: boolean; last: boolean },
  onMove: (direction: 'up' | 'down') => void,
): ActionMenuItem[] {
  return [
    { key: 'move-up', label: t('applications.moveUp'), icon: ArrowUp, disabled: position.first, onSelect: () => onMove('up') },
    { key: 'move-down', label: t('applications.moveDown'), icon: ArrowDown, disabled: position.last, onSelect: () => onMove('down') },
  ];
}
