import { EmptyState } from '@/shared/ui';

type ShellEmptyStateProps = {
  title: string;
  description: string;
};

/** Rendered by Shell in place of the terminal when no project is selected. */
export default function ShellEmptyState({ title, description }: ShellEmptyStateProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState title={title} message={description} />
    </div>
  );
}
