import { useContext } from 'react';
import type { ReactNode } from 'react';

import { createStableContext } from '@/shared/context/stableContext';
import type { CompanionMaterial } from '@/shared/types';

/**
 * What a core is asked to draw: the material it is made of, what it is doing (the body has a form for each: at rest, thinking,
 * reading, writing, speaking, and listening while it waits on the reader), how hard it is driven (0 to 1), the square it fills in px,
 * and where what it reads or writes to lies from it (`azimuth`, degrees counter-clockwise from three o'clock).
 */
export type CoreDrawingInput = {
  material: CompanionMaterial;
  state: 'idle' | 'thinking' | 'reading' | 'writing' | 'speaking' | 'listening';
  drive: number;
  size: number;
  azimuth: number;
};

/** Draws a core. Null where no page has given one: the caller then draws its own plain mark. */
type CoreDrawing = ((core: CoreDrawingInput) => ReactNode) | null;

const CoreDrawingContext = createStableContext<CoreDrawing>(import.meta.hot, 'CoreDrawingContext', null);

/**
 * THE CORE'S DRAWING, HANDED DOWN. The instrument that draws a core is the companion module's (`CompanionAvatar`), and the companion module
 * draws on the chat's own parts, so the chat cannot import it without a cycle. The page that mounts the chat (project-workspace's
 * `WorkspaceMain`) provides the drawing here, and the chat's core (`ChatCore`) asks for it: the same instrument, one for each chat, with no
 * module reaching into another.
 */
export const CoreDrawingProvider = CoreDrawingContext.Provider;

/** The drawing the page gave, or null where none was given. Read by the chat module's `ChatCore`. */
export function useCoreDrawing(): CoreDrawing {
  return useContext(CoreDrawingContext);
}
