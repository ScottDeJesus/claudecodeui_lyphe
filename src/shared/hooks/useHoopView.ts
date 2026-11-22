import { useState } from 'react';

import type { HoopView } from '@/shared/types';

/** Where this device keeps each screen's choice: one key per screen, after this prefix. */
const HOOP_VIEW_STORAGE_PREFIX = 'hoop-view:';

/** The screens whose instrument can be shown as a list: the Bugs view (its board and its proposed features) and Cerberus's fleet. */
type HoopViewScreen = 'bugs' | 'fleet';

/** The choice this device last made for a screen; the hoop where none was made, or where the storage cannot be read. */
function readStoredHoopView(screen: HoopViewScreen): HoopView {
  try {
    return localStorage.getItem(HOOP_VIEW_STORAGE_PREFIX + screen) === 'list' ? 'list' : 'hoop';
  } catch {
    return 'hoop';
  }
}

/**
 * A screen's choice between its instrument's hoop and its list (`HoopView`), kept ON THIS DEVICE, as the file tree keeps its view: a
 * phone can show a crowded board as a list while a desk keeps the hoop. It is read once as the screen mounts, so the first paint is
 * already the one chosen; the hoop until a choice is made.
 *
 * Used by the kanban module's `KanbanPanel` (`bugs`) and the cerberus module's `CerberusPanel` (`fleet`), each the one owner of its
 * screen's choice; the switch in the head is theirs to draw (`HoopViewSwitch`).
 */
export function useHoopView(screen: HoopViewScreen): [HoopView, (next: HoopView) => void] {
  // The screen's choice as this device last made it: read once on mount, then each press writes it here and to the device.
  const [view, setView] = useState<HoopView>(() => readStoredHoopView(screen));

  const choose = (next: HoopView) => {
    setView(next);
    try {
      localStorage.setItem(HOOP_VIEW_STORAGE_PREFIX + screen, next);
    } catch {
      // A storage that refuses it keeps the choice for this visit only.
    }
  };

  return [view, choose];
}
