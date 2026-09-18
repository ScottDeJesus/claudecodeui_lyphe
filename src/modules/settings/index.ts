import { lazy } from 'react';

// Lazy: Settings opens on demand and is a large tree. It loads on first use, so a module that imports this barrel never pulls it into
// the first page load.
export const Settings = lazy(() => import('@/modules/settings/Settings'));
