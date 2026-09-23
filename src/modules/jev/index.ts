import { lazy } from 'react';

// The jev module's public surface: the Jev view the API tab renders under its Jev sub-tab, plus the
// section frame and the formatters the DeepSeek view shares so both views read in one hand. The
// panel is lazy, the way the Heal, Memory and Runner panels are, so importing this barrel never pulls
// it into the first page load; the frame and formatters are small and eager.
export const JevPanel = lazy(() => import('@/modules/jev/JevPanel').then((m) => ({ default: m.JevPanel })));
export { JevSection } from '@/modules/jev/JevSection';
export { ago, count, pct, tokens, usd } from '@/modules/jev/jevFormat';
