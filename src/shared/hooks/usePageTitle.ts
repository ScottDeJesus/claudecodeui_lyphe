import { useEffect } from 'react';

import { getPageTitle } from '@/shared/utils';
import type { Project, ProjectSession } from '@/shared/types';

/**
 * Keeps the browser tab named after the open chat.
 *
 * ⚠ Call this from something that renders in EVERY sidebar mode. It used to live inside
 * `SidebarProjectList` — the project tree — which the simple chat list replaces outright, so a
 * reader in simple mode got the bare app name in the tab no matter which conversation was open.
 * A document-level side effect owned by a sometimes-rendered component is a title that is
 * sometimes right.
 */
export function usePageTitle(selectedProject: Project | null, selectedSession: ProjectSession | null): void {
  const pageTitle = getPageTitle(selectedProject, selectedSession);

  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);
}
