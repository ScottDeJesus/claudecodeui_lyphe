import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';

/**
 * A verb: takes every application down, and the workspace is in front. The context's `close`, stable for the provider's life.
 *
 * Exported through the module's barrel for the project-workspace module's CompanionHost, which brings the workspace forward
 * before it lands the Roadmap tab on a card, since an application over the main region hides the tab whatever the route says.
 */
export function useBackToWorkspace(): () => void {
  return useAppSwitcher().close;
}
