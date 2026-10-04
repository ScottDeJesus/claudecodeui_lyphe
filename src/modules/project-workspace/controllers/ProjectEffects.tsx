import { useEffect } from 'react';

import { usePaletteOpsRegister } from '@/modules/command-palette';
import { writeSelectedProvider } from '@/shared/selectedProvider';
import { useProjectEffectsState } from '@/modules/project-workspace/context/ProjectsStateContext';
import type { LLMProvider, ProjectWorkspaceShellProps } from '@/shared/types';

/** Headless controller rendered by ProjectWorkspaceShell to register palette operations and handle service-worker navigation messages. */
export default function ProjectEffects({
  navigate,
}: Pick<ProjectWorkspaceShellProps, 'navigate'>) {
  const {
    openSettings,
    refreshProjectsSilently,
    setActiveTab,
    setSidebarOpen,
  } = useProjectEffectsState();

  usePaletteOpsRegister({
    openSettings,
    refreshProjects: refreshProjectsSilently,
  });

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.type !== 'notification:navigate') {
        return;
      }

      if (typeof message.provider === 'string' && message.provider.trim()) {
        writeSelectedProvider(message.provider as LLMProvider);
      }

      setActiveTab('chat');
      setSidebarOpen(false);
      void refreshProjectsSilently();

      // The push's own landing, when it carries one: a plan's prompt lands on
      // `/session/<id>?runner=<plan>` (or `/?runner=<plan>` with no session), and the workspace's
      // `useRunnerLanding` picks the `runner` param up from there. Anything not rooted — a message
      // from a service worker older than the field — falls through to the two landings below.
      if (typeof message.urlPath === 'string' && message.urlPath.startsWith('/')) {
        navigate(message.urlPath);
        return;
      }

      if (typeof message.sessionId === 'string' && message.sessionId) {
        navigate(`/session/${message.sessionId}`);
        return;
      }

      navigate('/');
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [navigate, refreshProjectsSilently, setActiveTab, setSidebarOpen]);

  return null;
}
