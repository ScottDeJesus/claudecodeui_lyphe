import { lazy } from 'react';

// The gemini-spend module's public surface: the Gemini view the API tab renders under its Gemini sub-tab, and nothing
// else. Lazy, like the two views beside it: the view loads on the sub-tab's first open.
export const GeminiUsagePanel = lazy(() => import('@/modules/gemini-spend/GeminiUsagePanel').then((m) => ({ default: m.GeminiUsagePanel })));
