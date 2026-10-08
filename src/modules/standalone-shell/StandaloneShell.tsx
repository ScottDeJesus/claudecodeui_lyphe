import { Suspense, useCallback, useState } from 'react';

import type { Project, ProjectSession } from '@/shared/types';
import StandaloneShellEmptyState from '@/modules/standalone-shell/StandaloneShellEmptyState';
import StandaloneShellHeader from '@/modules/standalone-shell/StandaloneShellHeader';
import { Shell } from '@/modules/shell';

type StandaloneShellProps = {
  project?: Project | null;
  session?: ProjectSession | null;
  command?: string | null;
  isPlainShell?: boolean | null;
  isActive?: boolean;
  autoConnect?: boolean;
  onClose?: (() => void) | null;
  title?: string | null;
  className?: string;
  showHeader?: boolean;
  compact?: boolean;
  minimal?: boolean;
};

/** This module's only public export: used by the project-workspace module for its shell tab and by provider-auth to run an interactive login command. */
export default function StandaloneShell({
  project = null,
  session = null,
  command = null,
  isPlainShell = null,
  isActive = true,
  autoConnect = true,
  onClose = null,
  title = null,
  className = '',
  showHeader = true,
  compact = false,
  minimal = false,
}: StandaloneShellProps) {
  const [isCompleted, setIsCompleted] = useState(false);

  // Keep `compact` in the public API for compatibility with existing callers.
  void compact;

  const shouldUsePlainShell = isPlainShell !== null ? isPlainShell : command !== null;

  // The header's "completed" mark is the only thing the command's exit changes here. It is deliberately not
  // handed to the caller: `claude /login` never exits, so a caller that waited on it would wait forever.
  const handleProcessComplete = useCallback(() => {
    setIsCompleted(true);
  }, []);

  if (!project) {
    return <StandaloneShellEmptyState className={className} />;
  }

  return (
    <div className={`flex h-full w-full flex-col ${className}`}>
      {!minimal && showHeader && title && (
        <StandaloneShellHeader title={title} isCompleted={isCompleted} onClose={onClose} />
      )}

      <div className="min-h-0 w-full flex-1">
        <Suspense fallback={null}>
        <Shell
          selectedProject={project}
          selectedSession={session}
          initialCommand={command}
          isPlainShell={shouldUsePlainShell}
          isActive={isActive}
          onProcessComplete={handleProcessComplete}
          minimal={minimal}
          autoConnect={minimal ? true : autoConnect}
        />
        </Suspense>
      </div>
    </div>
  );
}
