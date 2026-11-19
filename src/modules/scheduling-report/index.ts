import { lazy } from 'react';

// The scheduling-report module's public surface: the Scheduling view. Its parts, its fixtures and its utils stay inside the
// module; each file there imports its siblings by path, never through this barrel.

// The Scheduling view, mounted by src/modules/cerberus (CerberusPanel, through its `KeptView`, which keeps it mounted) as
// the seventh view of the Cerberus tab's strip, after Uploads: what happens when someone schedules in Restorly, session by
// session, read-only. Its code stays its own module. Lazy: the view is its own chunk, loaded the first time Scheduling is
// shown, so opening the Cerberus tab never pulls it in.
export const SchedulingView = lazy(() => import('@/modules/scheduling-report/SchedulingView').then((m) => ({ default: m.SchedulingView })));
