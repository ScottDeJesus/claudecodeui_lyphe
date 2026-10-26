import { lazy } from 'react';

// Lazy: The wizard opens on demand. It loads on first use, so a module that imports this barrel never pulls it into
// the first page load.
export const ProjectCreationWizard = lazy(() => import('@/modules/project-creation-wizard/ProjectCreationWizard'));

// Lazy for the same reason. Used by the file-manager module's FilesView, whose "Pin a folder" opens the wizard's own
// folder browser rather than a picker of its own.
export const FolderBrowserModal = lazy(() => import('@/modules/project-creation-wizard/FolderBrowserModal'));

// Used by the file-manager module's FilesView to register a folder the app has never opened as a project, the house's
// one door to a browsable folder; it throws the server's own sentence on a refusal.
export { createProjectRequest } from '@/modules/project-creation-wizard/utils/workspaceApi';
