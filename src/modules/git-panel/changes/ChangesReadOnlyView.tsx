import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { Badge, Banner, EmptyState, Spinner } from '@/shared/ui';
import { FILE_STATUS_GROUPS } from '@/shared/constants';
import type { FileOpenHandler, GitCommitSummary, GitStatusResponse, UpstreamPosition } from '@/shared/types';
import {
  getStatusChipLetter,
  getStatusLabel,
  getStatusTone,
  isDirectoryPath,
  selectUnpushedCommits,
} from '@/modules/git-panel/utils/gitPanelUtils';
import GitDiffViewer from '@/modules/git-panel/GitDiffViewer';
import GitFailureBanner from '@/modules/git-panel/GitFailureBanner';

type ChangesReadOnlyViewProps = {
  status: GitStatusResponse | null;
  /** Recent commits, or null when that read failed — an empty list is a repository with no history, which is a different answer. */
  commits: GitCommitSummary[] | null;
  /** Where this branch stands against its upstream — decided once, by GitPanel, for the header and this view together. */
  upstream: UpstreamPosition;
  isMobile: boolean;
  diffFor: (filePath: string) => Promise<string>;
  onFileOpen?: FileOpenHandler;
};

/** The one sentence for a branch that tracks nothing — read by the empty state and the section alike, so the two never drift. */
const NO_UPSTREAM_COPY = "This branch isn't tracking a remote, so we can't tell what has been pushed.";

/** One section's frame: a titled card the rows sit inside. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5 text-xs uppercase tracking-widest text-ink-faint">
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * What a CLEAN working tree has to say, which turns on the upstream. A failed read is none of
 * these on purpose: a failure is not an empty state, and it is drawn in the sections below.
 */
function describeSettled(upstream: UpstreamPosition): { title: string; message: string } | null {
  switch (upstream.kind) {
    case 'tracked':
      // Only with NOTHING ahead — an unpushed commit is still something waiting. The ref named
      // is the one this branch is measured against, never a ref name written into the code.
      return upstream.ahead === 0
        ? { title: 'Nothing waiting to be pushed', message: `Your working tree matches ${upstream.remoteBranch ?? 'its upstream'}. New changes will show up here as you or an agent make them.` }
        : null;
    case 'no-commits':
      return { title: 'No commits yet', message: 'Nothing has been committed in this repository, so there is nothing to push.' };
    case 'no-upstream':
      return { title: 'No upstream yet', message: NO_UPSTREAM_COPY };
    case 'unread':
      return null;
  }
}

/**
 * Rendered by GitPanel for the Changes tab: what is committed but unpushed, what is changed
 * but uncommitted, and the diff of whichever row is open.
 *
 * Nothing here writes. A row opens its own diff; the only way out to the rest of the app is
 * "Open in Files", which hands the path to the workspace's file manager.
 *
 * The diff opens UNDER THE ROW, not in a card below the lists where the prototype draws it:
 * that mock has three rows, this working tree has 307 (measured), and a card after the lists
 * is three hundred rows from the click. Under the row is also the History tab's own shape.
 */
export default function ChangesReadOnlyView({
  status,
  commits,
  upstream,
  isMobile,
  diffFor,
  onFileOpen,
}: ChangesReadOnlyViewProps) {
  // Which changed file's diff is open. One at a time: the panel is a place to look at a
  // change, not a place to hold several open at once.
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // The diff text for that path, null while it is still being read.
  const [diff, setDiff] = useState<string | null>(null);
  // Why the diff could not be read, so a failure never renders as an empty diff.
  const [diffError, setDiffError] = useState<string | null>(null);
  /** Which diff request is current — an older response is dropped rather than shown. */
  const diffRequestRef = useRef(0);

  const toggleDiff = useCallback(async (filePath: string) => {
    const request = diffRequestRef.current + 1;
    diffRequestRef.current = request;

    // A second click on the open row closes it — the same gesture the History tab uses, and
    // the only way to put a long diff away without opening a different file to replace it.
    if (selectedPath === filePath) {
      setSelectedPath(null);
      setDiff(null);
      setDiffError(null);
      return;
    }

    setSelectedPath(filePath);
    setDiff(null);
    setDiffError(null);

    // A directory has no diff to fetch — the server would answer with a sentence saying so,
    // which is a round trip to be told what the trailing slash already said.
    if (isDirectoryPath(filePath)) {
      return;
    }

    try {
      const text = await diffFor(filePath);
      if (diffRequestRef.current !== request) return;
      setDiff(text);
    } catch (cause) {
      if (diffRequestRef.current !== request) return;
      setDiffError(cause instanceof Error ? cause.message : 'Could not read this diff');
    }
  }, [diffFor, selectedPath]);

  // Every changed path with the status git filed it under, in the order the shared group
  // table fixes, so this list and a commit's file list read the same way round.
  const changedRows = useMemo(
    () => FILE_STATUS_GROUPS.flatMap(({ key, status: code }) =>
      (status?.[key] ?? []).map((path) => ({ path, status: code }))),
    [status],
  );

  // Untracked DIRECTORIES are one porcelain entry apiece however many files they hold, so the
  // headline counts entries and cannot count files. Said under the list rather than left for
  // the reader to work out from a number that looks exact.
  const untrackedFolderCount = changedRows.filter((row) => isDirectoryPath(row.path)).length;

  // How many commits the upstream says are unpushed — a count only a TRACKED branch has — and
  // the rows for it, or null when they cannot be named: the read failed, or HEAD fell out of a
  // window that spans every ref, where a slice from the top would list PUSHED commits.
  const ahead = upstream.kind === 'tracked' ? upstream.ahead : 0;
  const unpushedCommits = ahead === 0 ? [] : commits === null ? null : selectUnpushedCommits(commits, ahead);

  // GitPanel holds the panel back until the first read lands, so "nothing here" is a settled
  // working tree rather than one that has not been read.
  const settled = changedRows.length === 0 ? describeSettled(upstream) : null;
  if (settled) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <EmptyState title={settled.title} message={settled.message} />
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3.5 overflow-y-auto p-4">
      {/* The unpushed count is UNKNOWN in two ways, and they are told apart: a branch that
          tracks nothing is a fact, a read that failed is an error (amber) — and neither is
          ever the good news that nothing is waiting (handoff §5). */}
      {upstream.kind === 'unread' && (
        <Section title="Already committed, not pushed · —">
          <div className="p-3" title={upstream.reason ?? undefined}>
            <Banner tone="warn">
              <p>The upstream couldn't be read, so we can't tell what has been pushed.</p>
            </Banner>
          </div>
        </Section>
      )}
      {upstream.kind === 'no-upstream' && (
        <Section title="Already committed, not pushed · —">
          <p className="px-4 py-3 text-sm text-muted-foreground">{NO_UPSTREAM_COPY}</p>
        </Section>
      )}

      {ahead > 0 && (
        // Titled from `ahead`, never from the list: the header badge reads the same number,
        // and two counts for one fact on one screen is how a reader learns to trust neither.
        <Section title={`Already committed, not pushed · ${ahead}`}>
          {unpushedCommits === null ? (
            <div className="p-3">
              <Banner tone="warn">
                <p>
                  {ahead} {ahead === 1 ? 'commit is' : 'commits are'} waiting to be pushed, but{' '}
                  {commits === null
                    ? "the list couldn't be read."
                    : `the read covers only the ${commits.length} most recent commits across every branch, and this branch's tip isn't among them.`}
                </p>
              </Banner>
            </div>
          ) : (
            <>
              {unpushedCommits.map((commit) => (
                <div
                  key={commit.hash}
                  className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0"
                >
                  <span className="shrink-0 font-mono text-xs text-accent-ink">
                    {commit.hash.substring(0, 7)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{commit.message}</span>
                </div>
              ))}
              {/* The read is capped at 50, so a branch far enough ahead has more unpushed
                  commits than were fetched; a list silently cut reads as the whole truth. */}
              {unpushedCommits.length > 0 && ahead > unpushedCommits.length && (
                <p className="border-t border-border px-4 py-2 text-xs text-ink-faint">
                  Showing the most recent {unpushedCommits.length}.
                </p>
              )}
            </>
          )}
        </Section>
      )}

      {changedRows.length > 0 && (
        <Section title={`Changed, not committed yet · ${changedRows.length}`}>
          {changedRows.map(({ path, status: code }) => (
            <div key={`${code}-${path}`} className="border-b border-border last:border-0">
              <button
                type="button"
                aria-expanded={selectedPath === path}
                onClick={() => void toggleDiff(path)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/60${
                  selectedPath === path ? ' bg-muted/60' : ''
                }`}
              >
                <Badge
                  tone={getStatusTone(code)}
                  // Untracked is drawn as an outline rather than a fill: git has never seen the
                  // file, and a dashed edge says "not yet counted" where a solid one would read
                  // as a state git has an opinion about. `border-dashed` is a call-site shape,
                  // not a colour — the tone still comes from the token block.
                  className={`w-8 shrink-0 justify-center px-0 font-semibold${code === 'U' ? ' border-dashed border-current' : ''}`}
                  title={getStatusLabel(code)}
                >
                  {getStatusChipLetter(code)}
                </Badge>
                <span data-git-path className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
                  {path}
                </span>
                {code === 'U' && (
                  <span className="shrink-0 text-xs text-ink-faint">
                    {isDirectoryPath(path) ? 'New folder · never committed' : 'New file · never committed'}
                  </span>
                )}
              </button>

              {selectedPath === path && (
                <div className="border-t border-border bg-muted/40">
                  <div className="flex items-center gap-3 px-4 py-2">
                    <span data-git-path className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
                      {path}
                    </span>
                    {onFileOpen && (
                      <button
                        type="button"
                        className="shrink-0 text-xs text-accent-ink hover:underline"
                        onClick={() => onFileOpen(path)}
                      >
                        Open in Files
                      </button>
                    )}
                  </div>
                  {isDirectoryPath(path) ? (
                    // git reports a wholly-untracked directory as ONE entry, and the server has
                    // no diff to give for it. Said here as designed copy rather than letting its
                    // "(Cannot show diff for directories)" sentence render as two diff lines.
                    <p className="px-4 pb-4 text-sm text-muted-foreground">
                      A folder git has never seen. Nothing inside it is tracked yet, so there is
                      no diff to show — open it in Files to look through it.
                    </p>
                  ) : diffError ? (
                    <div className="px-4 pb-4">
                      <GitFailureBanner error={diffError} />
                    </div>
                  ) : diff === null ? (
                    <div className="flex items-center justify-center p-6">
                      <Spinner size={28} label="Reading the diff" />
                    </div>
                  ) : (
                    <div className="max-h-[28rem] overflow-y-auto pb-2">
                      <GitDiffViewer diff={diff} isMobile={isMobile} />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {untrackedFolderCount > 0 && (
            <p className="border-t border-border px-4 py-2 text-xs text-ink-faint">
              {untrackedFolderCount} of these {untrackedFolderCount === 1 ? 'is a folder' : 'are folders'} git
              has never opened; the files inside {untrackedFolderCount === 1 ? 'it are' : 'them are'} not
              counted separately.
            </p>
          )}
        </Section>
      )}
    </div>
  );
}
