import { lazy } from 'react';

// The memory-intake module's whole public surface: the provider App mounts, the reading the
// workspace tab gates and the command palette ask for, and the panel the Memory tab renders.
export { MemoryIntakeProvider } from '@/modules/memory-intake/context/MemoryIntakeContext';
export { useMemoryIntake } from '@/modules/memory-intake/context/MemoryIntakeContext';

// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const MemoryIntakePanel = lazy(() => import('@/modules/memory-intake/MemoryIntakePanel').then((m) => ({ default: m.MemoryIntakePanel })));
// The lane as the desktop chat gutter draws it: this chat's queue, then what was recently filed.
// Its consumer is src/modules/chat-gutters, which mounts it beside the transcript.
export { MemoryWidgetBody } from '@/modules/memory-intake/MemoryWidgetBody';
