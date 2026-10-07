import { createContext, useContext } from 'react';

import type { ProjectChoice } from '@/shared/types';

/**
 * The projects the workspace lists in its sidebar, which `CerberusPanel` is handed by `WorkspaceMain`
 * and provides to the Fleet view beneath it. It is a context, not a prop chain, because the one reader,
 * `NodeProjects`, stands five components down (panel, Fleet, grid or list or rings, card, section) and
 * none of the four between has any use for it.
 *
 * Why the panel is handed the list instead of reading it: the list is the workspace's own state, which
 * `project-workspace` owns and which imports this module. Reading it from here would turn that into a cycle.
 *
 * `null` is "no workspace has said": a section drawn outside a panel offers nothing and waits.
 */
export const ProjectChoicesContext = createContext<ProjectChoice[] | null>(null);

/** The workspace's projects as the panel was last handed them, or `null` outside a panel. Read by `NodeProjects` for its "Run a project here" menu. */
export function useProjectChoices(): ProjectChoice[] | null {
  return useContext(ProjectChoicesContext);
}
