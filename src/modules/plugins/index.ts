import { lazy } from 'react';

export { PluginsProvider, usePlugins } from '@/modules/plugins/context/PluginsContext';

// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const PluginTabContent = lazy(() => import('@/modules/plugins/PluginTabContent'));
// Settings' Plugins tab, lazy for the same reason: nothing on the first load renders it.
export const PluginSettingsTab = lazy(() => import('@/modules/plugins/PluginSettingsTab'));
