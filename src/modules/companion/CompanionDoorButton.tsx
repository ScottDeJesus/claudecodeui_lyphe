import { CompanionDoorView } from '@/modules/companion/CompanionDock';
import { useCompanion } from '@/modules/companion/context/CompanionContext';

/**
 * Her door on the page: what WorkspaceRail renders in its foot, just above the Inbox. It reads the open state and her
 * name from the companion's provider and toggles the panel; CompanionDock.tsx's CompanionDoorView draws it.
 */
export function CompanionDoorButton() {
  const { picture, open, setOpen } = useCompanion();

  return <CompanionDoorView open={open} name={picture?.settings.name ?? null} onPress={() => setOpen(!open)} />;
}
