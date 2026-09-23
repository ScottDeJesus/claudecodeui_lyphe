import { lazy } from 'react';

// The deepseek-spend module's public surface: the DeepSeek view the API tab renders under its DeepSeek
// sub-tab, and nothing else. Lazy, like the Jev view beside it: the view loads on the sub-tab's first
// open, so importing this barrel never pulls it into the first page load.
export const DeepseekUsagePanel = lazy(() => import('@/modules/deepseek-spend/DeepseekUsagePanel').then((m) => ({ default: m.DeepseekUsagePanel })));
