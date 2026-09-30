import { useSyncExternalStore } from 'react';

import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

export type SimpleChatListPreferences = {
  enabled: boolean;
  projectId: string | null;
  setEnabled: (next: boolean) => void;
  setProjectId: (next: string | null) => void;
};

/**
 * The one reader of `simpleChatList` and `simpleChatProjectId` anywhere in
 * `src/`. Consumed by the sidebar (which view to render), settings (the
 * toggle and the project picker), chat (whether a newly minted session is
 * tagged into the simple list at creation time) and project-workspace
 * (`openProjectChat` saves the project a new chat opens in when the list is on).
 */
export function useSimpleChatListPreferences(): SimpleChatListPreferences {
  const enabled = useSyncExternalStore(
    subscribeToUserPreferences,
    () => readUserPreference('simpleChatList', true),
  );
  const projectId = useSyncExternalStore(
    subscribeToUserPreferences,
    () => readUserPreference<string | null>('simpleChatProjectId', null),
  );

  return {
    enabled,
    projectId,
    setEnabled: (next: boolean) => writeUserPreference('simpleChatList', next),
    setProjectId: (next: string | null) => writeUserPreference('simpleChatProjectId', next),
  };
}
