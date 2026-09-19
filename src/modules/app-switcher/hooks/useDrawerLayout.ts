import { useState } from 'react';

import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';
import {
  addRegistryDivider,
  moveRegistryRow,
  removeRegistryDivider,
  renameRegistryDivider,
} from '@/modules/app-switcher/utils/registryRequests';

/**
 * The drawer list's layout acts — add, rename and remove a divider, move any row — each one a
 * registry write followed by a re-read, so the list drawn is always the file's answer.
 *
 * A refused move or divider write lands in `layoutError`, the drawer's one banner for it, cleared
 * by the next act. `addedDividerId` is the divider just added, which opens straight into its title.
 */
export function useDrawerLayout() {
  const { refresh } = useAppSwitcher();
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [addedDividerId, setAddedDividerId] = useState<string | null>(null);

  async function run(act: () => Promise<void>) {
    setLayoutError(null);
    try {
      await act();
    } catch (failure) {
      setLayoutError(failure instanceof Error ? failure.message : String(failure));
    }
    await refresh();
  }

  function moveRow(rowId: string, direction: 'up' | 'down') {
    void run(() => moveRegistryRow(rowId, direction));
  }

  function addDivider() {
    void run(async () => setAddedDividerId(await addRegistryDivider('')));
  }

  // Rejects on a refusal: the divider keeps its field open with the sentence under it.
  async function renameDivider(dividerId: string, title: string) {
    await renameRegistryDivider(dividerId, title);
    await refresh();
  }

  function removeDivider(dividerId: string) {
    void run(() => removeRegistryDivider(dividerId));
  }

  return {
    layoutError,
    clearLayoutError: () => setLayoutError(null),
    addedDividerId,
    moveRow,
    addDivider,
    renameDivider,
    removeDivider,
  };
}
