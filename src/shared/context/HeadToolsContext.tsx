import { useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { createStableContext } from '@/shared/context/stableContext';

/** The head's place for a screen's own presses, once a head has drawn it, and the call the head gives it with. */
type HeadToolsValue = { place: HTMLElement | null; setPlace: (place: HTMLElement | null) => void };

const HeadToolsContext = createStableContext<HeadToolsValue | null>(import.meta.hot, 'HeadToolsContext', null);

/**
 * A SCREEN'S OWN PRESSES IN THE SCREEN HEAD. The head drawn over a screen (`ScreenHead`) knows nothing of the screen under it; a
 * screen with a press of its own for the head (Cerberus's switch between its fleet's hoop and its list, R&D's Scout now) draws it into
 * the head's place for one (`HeadTools`), just before the menu, for as long as the screen stands and the press means something there.
 * So a page's presses stand together on one line with the way back and the Menu, not at a corner of the page under them.
 *
 * Rendered by project-workspace's `ProjectWorkspaceShell` round every page.
 */
export function HeadToolsProvider({ children }: { children: ReactNode }) {
  // The head's place for a screen's presses: null while no head is drawn, so a screen with nothing to draw into draws nothing.
  const [place, setPlace] = useState<HTMLElement | null>(null);
  const value = useMemo<HeadToolsValue>(() => ({ place, setPlace }), [place]);
  return <HeadToolsContext.Provider value={value}>{children}</HeadToolsContext.Provider>;
}

/**
 * The place in a screen's head where the screen's own presses stand, before the menu. It lays them out as the head's own items
 * (`contents`), so it takes no room while it holds none.
 *
 * Used by project-workspace's `ScreenHead`.
 */
export function HeadToolsPlace() {
  const tools = useContext(HeadToolsContext);
  return <div ref={tools?.setPlace} data-screen-head-tools="" className="contents" />;
}

/**
 * A screen's own presses, drawn in the screen head's place for them; nothing where no head is drawn.
 *
 * Used by the cerberus module's `CerberusPanel` (its switch between the fleet's hoop and its list), the rnd module's `RndPanel`
 * (Scout now and the settings) and the schedules module's `SchedulesPanel` (Refresh).
 */
export function HeadTools({ children }: { children: ReactNode }) {
  const tools = useContext(HeadToolsContext);
  return tools?.place ? createPortal(children, tools.place) : null;
}
