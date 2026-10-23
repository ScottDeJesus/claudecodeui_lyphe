import { lazy } from 'react';

// The carrier-bulletins module's public surface: the Bulletins view. Its screens, its hooks and its utils stay inside the
// module; each file there imports its siblings by path, never through this barrel.

// The Bulletins view, mounted by src/modules/cerberus (CerberusPanel, through its `KeptView`, which keeps it mounted) as the
// fifth view of the Cerberus tab's strip, after Tours — the operator's ruling that the dashboard is a view of CloudCLI's Cerberus tab ("were going to ditch the
// standalone cerberus favoring cerberus tab in cloudcli") — while its code stays its own module. Lazy: the view is its own
// chunk, loaded the first time Bulletins is shown, so opening the Cerberus tab never pulls it in.
export const BulletinsView = lazy(() => import('@/modules/carrier-bulletins/BulletinsView').then((m) => ({ default: m.BulletinsView })));
