import { lazy } from 'react';

// Lazy: The wizard opens on demand. It loads on first use, so a module that imports this barrel never pulls it into
// the first page load.
export const ProjectCreationWizard = lazy(() => import('@/modules/project-creation-wizard/ProjectCreationWizard'));
