import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { WorkspaceHome } from '@/modules/project-workspace/home/WorkspaceHome';
import { useHomeShowing } from '@/shared/context/StationLayerContext';
import { HeldPage } from '@/shared/ui';

/**
 * The sessions home's door into the page, rendered by `ProjectWorkspaceShell` beside the frame and the station's layer.
 *
 * IT MOUNTS ON ITS FIRST VISIT AND STAYS MOUNTED, as the station does: nothing of it is built, and its board reads no chat, for a window that never opens
 * it; once opened it is held out of reach (`HeldPage`) while another page is on screen, so a return to it draws what it held — its scroll, a name half
 * typed — and fetches nothing.
 *
 * While it is the page on screen the tab's title is the home's.
 */
export function WorkspaceHomeLayer() {
  const { t } = useTranslation();
  const showing = useHomeShowing();
  // Whether the home has ever been the page on screen. State, because mounting it is the one thing this does and a sticky flag is what keeps it mounted after.
  const [visited, setVisited] = useState(showing);
  if (showing && !visited) setVisited(true);

  const title = t('home.title');
  useEffect(() => {
    if (!showing) return undefined;
    const before = document.title;
    document.title = title;
    return () => { document.title = before; };
  }, [showing, title]);

  if (!visited) return null;
  return (
    <HeldPage held={!showing}>
      <WorkspaceHome visited={visited} />
    </HeldPage>
  );
}
