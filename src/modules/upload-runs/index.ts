import { lazy } from 'react';

// The upload-runs module's public surface: the Uploads view. Its parts, its hooks and its utils stay inside the module;
// each file there imports its siblings by path, never through this barrel.

// The Uploads view, mounted by src/modules/cerberus (CerberusPanel, through its `KeptView`, which keeps it mounted) as the
// sixth view of the Cerberus tab's strip, after Bulletins: what happens when a person uses Restorly's Uploads page, run by
// run, read-only. Its code stays its own module. Lazy: the view is its own chunk, loaded the first time Uploads is shown,
// so opening the Cerberus tab never pulls it in.
export const UploadsView = lazy(() => import('@/modules/upload-runs/UploadsView').then((m) => ({ default: m.UploadsView })));
