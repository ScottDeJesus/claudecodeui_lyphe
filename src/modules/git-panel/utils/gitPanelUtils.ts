import type {
  FileStatusCode,
  GitCommitSummary,
  GitRemoteStatus,
  GitStatusResponse,
  Tone,
  UpstreamPosition,
} from '@/shared/types';

const FILE_STATUS_LABELS: Record<FileStatusCode, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  U: 'Untracked',
};

/**
 * The tone each file status speaks in — the ONLY place this module decides that, so the
 * changed-file rows and a commit's own file list can never disagree about what a colour means.
 *
 * `D` takes `danger` because the file is gone, which is the one state here that reports a
 * loss; it is the tone token, never a red of this module's own (doctrine §5). `U` is
 * neutral — an untracked file is unknown to git, not wrong.
 */
const FILE_STATUS_TONES: Record<FileStatusCode, Tone> = {
  M: 'warn',
  A: 'positive',
  D: 'danger',
  U: 'neutral',
};

/** Used by the changed-file rows and by a commit's file list to name a status in words. */
export function getStatusLabel(status: FileStatusCode): string {
  return FILE_STATUS_LABELS[status] || status;
}

/** Used by those same two lists to tone a status chip. */
export function getStatusTone(status: FileStatusCode): Tone {
  return FILE_STATUS_TONES[status] || 'neutral';
}

/**
 * What the chip actually prints. Untracked shows `?` rather than `U` because that is the
 * mark git itself uses for a path it has never seen, and the reader has met it before.
 */
export function getStatusChipLetter(status: FileStatusCode): string {
  return status === 'U' ? '?' : status;
}

/**
 * `git status --porcelain` collapses a wholly-untracked directory to one `?? dir/` entry, so a
 * trailing slash is the only thing that tells a folder from a file here. Both the row's label
 * and what opening it shows turn on this.
 */
export function isDirectoryPath(path: string): boolean {
  return path.endsWith('/');
}

/**
 * A git failure said in plain English, with the plumbing kept for whoever wants it.
 *
 * Used by the panel's repository error state and by a diff that would not read — one place
 * decides how a failure reads, so `fatal: bad object` and an Express error string cannot each
 * grow their own wording. `raw` is what a `title=` hands to a reader who wants the real text.
 */
export function describeGitFailure(error: string, details?: string): {
  title: string;
  detail: string | null;
  raw: string;
} {
  const raw = [error, details].filter(Boolean).join(' — ');

  // The one failure shape the panel can actually name: a registered project whose directory
  // has been moved or deleted. Everything else is git plumbing nobody should have to read.
  // The path is the LAST thing in the message and may carry spaces, so it runs to the end of
  // the line rather than to the first blank.
  const missingPath = raw.match(/path not found:\s*([^\n]+)/i)?.[1]?.trim();
  if (missingPath) {
    return { title: "This project's folder is missing", detail: missingPath, raw };
  }

  return { title: 'Git could not read this', detail: null, raw };
}

/**
 * Decides the panel's `UpstreamPosition` — ONE call, made by GitPanel, whose answer the header
 * and the Changes view both read — from the server's own flags, never from the TYPE of `ahead`.
 *
 * `/api/git/remote-status` has three shapes that are not "tracked": a repository with no
 * commits (`hasUpstream: false` WITH `ahead: 0`), a branch with no tracking ref
 * (`hasUpstream: false`, no `ahead` key at all), and a read that failed (`error` only). Two of
 * those carry a zero or nothing, and none of them may ever be shown as "everything is pushed".
 */
export function describeUpstreamPosition(
  remoteStatus: GitRemoteStatus | null,
  status: GitStatusResponse | null,
): UpstreamPosition {
  if (!remoteStatus || remoteStatus.error) {
    return { kind: 'unread', reason: remoteStatus?.error ?? null };
  }
  if (remoteStatus.hasUpstream === true && typeof remoteStatus.ahead === 'number') {
    return { kind: 'tracked', ahead: remoteStatus.ahead, remoteBranch: remoteStatus.remoteBranch ?? null };
  }
  // `hasCommits` rides on /status, and it is the server's own reason for the first shape.
  if (status?.hasCommits === false) {
    return { kind: 'no-commits' };
  }
  if (remoteStatus.hasUpstream === false) {
    return { kind: 'no-upstream' };
  }
  // A body carrying neither flag is not a shape the server sends. Nothing is known from it.
  return { kind: 'unread', reason: null };
}

/**
 * The first `ahead` commits of THIS branch's history, taken from a list that was read for the
 * History graph and so spans every ref (`git log --branches --remotes --tags --topo-order`) —
 * or null when that list cannot say which those are.
 *
 * Topo-order puts children before parents, so nothing ABOVE the entry decorated `HEAD` can be
 * reachable from HEAD — a commit on another branch, or the remote's own newer commits when this
 * branch is behind — and the slice starts at HEAD rather than at the top. When HEAD is not in
 * the window at all (fifty or more newer commits on some other ref pushed it below the cut) the
 * whole window is other refs' commits, and a slice from its top would be a list of PUSHED
 * commits under a heading saying they are not: that is the null. What neither can rule out is
 * a foreign commit sorted BELOW HEAD inside the first `ahead` entries — the list is only
 * provably `@{u}..HEAD` when it is read as such, a server read this panel has not got
 * (git.routes.ts `/commits` asks every ref, for the graph).
 */
export function selectUnpushedCommits(commits: GitCommitSummary[], ahead: number): GitCommitSummary[] | null {
  if (ahead <= 0) return [];
  const headIndex = commits.findIndex((commit) =>
    commit.refs?.some((ref) => ref === 'HEAD' || ref.startsWith('HEAD -> ')));
  if (headIndex === -1) return null;
  return commits.slice(headIndex, headIndex + ahead);
}

// ---------------------------------------------------------------------------
// Parse `git show` output to extract per-file change info
// ---------------------------------------------------------------------------

export type CommitFileChange = {
  path: string;
  directory: string;
  filename: string;
  status: FileStatusCode;
  insertions: number;
  deletions: number;
};

export type CommitFileSummary = {
  files: CommitFileChange[];
  totalFiles: number;
  totalInsertions: number;
  totalDeletions: number;
};

/**
 * Used by the History tab's `CommitHistoryItem` to draw the stats card and the changed-file list
 * of an opened commit from the SAME text the diff viewer below them prints — one read, so the
 * two halves of that card cannot describe different commits.
 *
 * Everything is counted off the patch, so a commit with no patch counts to zero: `git show`
 * omits a MERGE's patch and prints only its header, and such a row draws Files 0 / +0 / -0 above
 * the header it did get. Known, and left as it is — the fix is a per-file read this panel does
 * not make (`.verify/phase-10.mjs` §7c measures what the route really returns for a merge).
 */
export function parseCommitFiles(showOutput: string): CommitFileSummary {
  const files: CommitFileChange[] = [];
  // Split on file diff boundaries
  const fileDiffs = showOutput.split(/^diff --git /m).slice(1);

  for (const section of fileDiffs) {
    const lines = section.split('\n');
    // Extract path from "a/path b/path"
    const header = lines[0] ?? '';
    const match = header.match(/^a\/(.+?) b\/(.+)/);
    if (!match) continue;

    const pathA = match[1];
    const pathB = match[2];

    // Determine status
    let status: FileStatusCode = 'M';
    const joined = lines.slice(0, 6).join('\n');
    if (joined.includes('new file mode')) status = 'A';
    else if (joined.includes('deleted file mode')) status = 'D';

    const filePath = status === 'D' ? pathA : pathB;

    // Count insertions/deletions (lines starting with +/- but not +++/---)
    let insertions = 0;
    let deletions = 0;
    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) insertions++;
      else if (line.startsWith('-')) deletions++;
    }

    const lastSlash = filePath.lastIndexOf('/');
    const directory = lastSlash >= 0 ? filePath.substring(0, lastSlash + 1) : '';
    const filename = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;

    files.push({ path: filePath, directory, filename, status, insertions, deletions });
  }

  return {
    files,
    totalFiles: files.length,
    totalInsertions: files.reduce((sum, f) => sum + f.insertions, 0),
    totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
  };
}
