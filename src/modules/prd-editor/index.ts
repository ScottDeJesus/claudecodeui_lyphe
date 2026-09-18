import { lazy } from 'react';

// Lazy: The editor brings CodeMirror. It loads on first use, so a module that imports this barrel never pulls it into
// the first page load.
export const PRDEditor = lazy(() => import('@/modules/prd-editor/PRDEditor'));
