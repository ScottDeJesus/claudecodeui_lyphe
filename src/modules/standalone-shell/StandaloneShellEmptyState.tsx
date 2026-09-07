import { EmptyState } from '@/shared/ui';

type StandaloneShellEmptyStateProps = {
  className: string;
};

/** Rendered by StandaloneShell when no project is selected, because a shell needs a working directory. */
export default function StandaloneShellEmptyState({ className }: StandaloneShellEmptyStateProps) {
  return (
    <div className={`flex h-full items-center justify-center p-6 ${className}`}>
      <EmptyState title="No project chosen" message="A shell opens inside a project's folder, so one has to be picked first." />
    </div>
  );
}
