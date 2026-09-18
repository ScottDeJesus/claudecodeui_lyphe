import { lazy } from 'react';

// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const GitRepositoriesPanel = lazy(() => import('@/modules/git-panel/GitRepositoriesPanel'));
export { selectGitRepository } from '@/modules/git-panel/hooks/useSelectedGitRepository';
