import { EmptyState } from '@/shared/ui';
import GitFailureBanner from '@/modules/git-panel/GitFailureBanner';

type GitRepositoryErrorStateProps = {
  error: string;
  details?: string;
  /** True when the project directory simply has no repository, rather than git failing. */
  notGitRepository?: boolean;
};

/**
 * Rendered by GitPanel when the git status read has nothing to show.
 *
 * It offers no action, and that is the point: initialising a repository is a write, and this
 * panel does not write. A folder that is not a repository is a fact stated plainly, not an
 * invitation.
 *
 * The two cases stay apart, and they are drawn by different components on purpose. A folder
 * with nothing tracked is an EMPTY state — the app looked and found nothing. A read that
 * FAILED is not empty, it is unknown, and EmptyState's own contract says so; it gets the
 * panel's failure banner instead.
 */
export default function GitRepositoryErrorState({
  error,
  details,
  notGitRepository = false,
}: GitRepositoryErrorStateProps) {
  if (notGitRepository) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          title="This folder is not a git repository"
          message="Nothing here is tracked, so there is no history or pending change to show."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-start justify-center p-6">
      <div className="w-full max-w-xl">
        <GitFailureBanner error={error} details={details} />
      </div>
    </div>
  );
}
