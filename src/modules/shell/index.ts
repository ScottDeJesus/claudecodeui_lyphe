import { lazy } from 'react';

// Lazy: The terminal brings xterm and its addons. It loads on first use, so a module that imports this barrel never pulls it into
// the first page load.
export const Shell = lazy(() => import('@/modules/shell/Shell'));
