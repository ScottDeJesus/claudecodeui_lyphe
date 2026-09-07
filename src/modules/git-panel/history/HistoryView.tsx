import { useCallback, useMemo, useState } from 'react';

import { api } from '@/shared/api';
import { Banner, EmptyState } from '@/shared/ui';
import type { GitApiErrorResponse, GitCommitSummary, GitDiffMap } from '@/shared/types';
import { computeCommitGraph } from '@/modules/git-panel/utils/commitGraph';
import CommitHistoryItem from '@/modules/git-panel/history/CommitHistoryItem';

type HistoryViewProps = {
  isMobile: boolean;
  /** Recent commits, or null when that read failed — which is not the same as a repository with none. */
  commits: GitCommitSummary[] | null;
  /** DB primary key of the project whose commits these are; the `project` param of every git route. */
  projectId: string;
};

/**
 * Rendered by GitPanel for the History tab, listing recent commits and their diffs.
 *
 * The commits themselves come from the panel's read controller, whose shape is fixed at
 * plan §6.6. A single commit's diff is not part of that shape and does not belong in it: it
 * is a detail of one row that has been opened, read once and kept only while this view is
 * mounted. So this view asks for it, through the shared api helper rather than a URL of
 * its own.
 */
export default function HistoryView({ isMobile, commits, projectId }: HistoryViewProps) {
  // Which commits the reader has opened. A Set because the only questions asked of it are
  // "is this one open" and "toggle this one".
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  // Diffs already read, keyed by commit hash, so re-opening a row costs nothing.
  const [commitDiffs, setCommitDiffs] = useState<GitDiffMap>({});
  // Why a diff could NOT be read, keyed the same way: a failed read is drawn as a failure under
  // the row, never as a row that opens onto nothing.
  const [commitDiffErrors, setCommitDiffErrors] = useState<Record<string, string>>({});

  // Lane layout for the commit graph; rows align 1:1 with commits.
  // Older API responses without `parents` degrade to plain rows (no strip).
  const graphRows = useMemo(() => {
    if (!commits || !commits.some((commit) => commit.parents !== undefined)) {
      return null;
    }
    return computeCommitGraph(commits);
  }, [commits]);

  const fetchCommitDiff = useCallback(async (commitHash: string) => {
    // A retry starts from nothing known: any earlier failure is dropped first, so the row says
    // it is reading again rather than holding the old banner until the new answer lands.
    setCommitDiffErrors((previous) => {
      if (!(commitHash in previous)) return previous;
      const next = { ...previous };
      delete next[commitHash];
      return next;
    });

    try {
      const response = await api.git.commitDiff(projectId, commitHash);
      const data = (await response.json()) as GitApiErrorResponse & { diff?: string };
      if (data.error) {
        const reason = data.details || data.error;
        setCommitDiffErrors((previous) => ({ ...previous, [commitHash]: reason }));
        return;
      }
      // Recorded even when the diff is EMPTY: keeping only a TRUTHY diff would make "landed on
      // nothing" and "still reading" the same fact, and the row draws them differently.
      // Defensive rather than a case the route emits — `git show` always prints at least a
      // commit header, so there is no empty-diff answer for a valid commit. A merge omits its
      // PATCH, not its header, and arrives here as that header (measured, phase-10.mjs §7c).
      setCommitDiffs((previous) => ({ ...previous, [commitHash]: data.diff ?? '' }));
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'Could not read this diff';
      setCommitDiffErrors((previous) => ({ ...previous, [commitHash]: reason }));
    }
  }, [projectId]);

  const toggleCommitExpanded = useCallback(
    (commitHash: string) => {
      const isExpanding = !expandedCommits.has(commitHash);

      setExpandedCommits((previous) => {
        const next = new Set(previous);
        if (next.has(commitHash)) {
          next.delete(commitHash);
        } else {
          next.add(commitHash);
        }
        return next;
      });

      // Load the diff lazily, the first time a commit is opened — keyed on whether the read has
      // HAPPENED, not on whether it produced text, so an empty diff is not re-fetched on every
      // re-open. A failed read stores no diff, so re-opening that row does retry it.
      if (isExpanding && !(commitHash in commitDiffs)) {
        void fetchCommitDiff(commitHash);
      }
    },
    [commitDiffs, expandedCommits, fetchCommitDiff],
  );

  // A read that FAILED is not an empty history; it is unknown, and an error is amber
  // (doctrine §5) — the EmptyState below would tell a reader the repository has no commits.
  if (commits === null) {
    return (
      <div className="p-4">
        <Banner tone="warn">
          <p>The commit history couldn't be read.</p>
        </Banner>
      </div>
    );
  }

  // GitPanel holds the panel back until the first read lands, so an empty list here means the
  // repository really has no commits — never "not read yet".
  if (commits.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          title="No commits yet"
          message="Once this repository has history, the most recent commits will be listed here."
        />
      </div>
    );
  }

  return (
    <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-4' : ''}`}>
      {commits.map((commit, index) => (
        <CommitHistoryItem
          key={commit.hash}
          commit={commit}
          isExpanded={expandedCommits.has(commit.hash)}
          diff={commitDiffs[commit.hash]}
          diffError={commitDiffErrors[commit.hash]}
          isMobile={isMobile}
          graphRow={graphRows?.[index]}
          onToggle={() => toggleCommitExpanded(commit.hash)}
        />
      ))}
    </div>
  );
}
