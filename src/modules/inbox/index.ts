import { lazy } from 'react';

// The inbox module's public surface: the Inbox view, which project-workspace's WorkspaceMain mounts as the `inbox`
// pane. Lazy, as the Memory and Heal panels it holds are: the view is its pane's whole tree and loads on its first
// open, so importing this barrel for anything else never pulls it into the first page load.
export const InboxPanel = lazy(() => import('@/modules/inbox/InboxPanel'));

// What waits on the operator, per section and in all. Read by project-workspace's useRailBadges for the Inbox glyph's
// badge: the hook's first reader outside this module.
export { useInboxWaiting } from '@/modules/inbox/hooks/useInboxWaiting';
