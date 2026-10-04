import { AppError } from '@/shared/utils.js';

type GitCommandResult = {
  stdout: string;
  stderr: string;
};

type GitCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string },
) => Promise<GitCommandResult>;

type DeleteLocalBranchInput = {
  projectPath: string;
  branch: string;
  force: boolean;
  runCommand: GitCommandRunner;
};

type LastPushedInput = {
  projectPath: string;
  /**
   * The upstream ref FULLY QUALIFIED, as `rev-parse --symbolic-full-name <branch>@{upstream}` printed
   * it, e.g. `refs/remotes/origin/main`. The short form is not enough: git resolves `origin/main` by
   * its own dwim order, where `refs/heads/<name>` comes before `refs/remotes/<name>`, so in a
   * repository that also holds a LOCAL branch called `origin/main` the short name names the local
   * branch and this reader would answer null about a branch that WAS pushed from here.
   */
  trackingRef: string;
  runCommand: GitCommandRunner;
};

/**
 * The reflog subject git writes on the remote-tracking ref when a push moves it. A fetch writes
 * `fetch <remote>: <update>`, so the two are never confused.
 */
const PUSH_REFLOG_SUBJECT = 'update by push';

/** `origin/main@{1790261171}` — the selector `--date=unix` makes `%gd` print, and the only place an entry's own time appears. */
const REFLOG_SELECTOR_EPOCH = /\{(\d+)\}$/;

/**
 * When this working copy last PUSHED the branch that tracks `trackingRef`, as an ISO timestamp, or
 * null when its reflog holds no push entry.
 *
 * The time is already on disk and needs no network: a push updates the remote-tracking ref and git
 * records the entry `update by push` for it. Measured in this repository, `git reflog show
 * --date=unix --format='%gd%x09%gs' refs/remotes/origin/main` → `refs/remotes/origin/main@{1790261171}\tupdate by push`.
 * A no-op push writes NO entry (git logs nothing when the ref does not move), so the newest
 * `update by push` entry really is the last push and never a repeat of it.
 *
 * Null is the honest answer to all three ways there is no such entry: this copy was cloned and
 * never pushed from here, the branch has no upstream at all (the route then does not call this),
 * or git has expired the entry. The panel says that state in words rather than printing a time it
 * does not have.
 */
export async function readLastPushedAt(input: LastPushedInput): Promise<string | null> {
  let stdout: string;
  try {
    ({ stdout } = await input.runCommand(
      'git',
      ['reflog', 'show', '--date=unix', '--format=%gd%x09%gs', input.trackingRef],
      { cwd: input.projectPath },
    ));
  } catch (error) {
    // A reflog that cannot be read is a MISSING answer, not a failed request: the upstream counts
    // ride on the same route response, and losing them over the timestamp would be worse than the
    // timestamp being absent. Logged rather than swallowed, because the alternative explanation —
    // a ref that does not exist — is a bug worth seeing.
    console.warn(`[git] could not read the push reflog of ${input.trackingRef}:`, error);
    return null;
  }

  // Newest first: git prints the reflog most-recent-entry-first, so the first match is the last push.
  for (const line of stdout.split('\n')) {
    const [selector, subject] = line.split('\t');
    // `trim` because a Windows checkout may hand this back with a trailing carriage return.
    if (subject?.trim() !== PUSH_REFLOG_SUBJECT) continue;
    const epochSeconds = Number(selector?.match(REFLOG_SELECTOR_EPOCH)?.[1]);
    if (!Number.isFinite(epochSeconds)) continue;
    return new Date(epochSeconds * 1000).toISOString();
  }

  return null;
}

/** Used by the Git routes module to safely delete a non-current local branch. */
export async function deleteLocalBranch(input: DeleteLocalBranchInput): Promise<string> {
  const { stdout: currentBranch } = await input.runCommand(
    'git',
    ['branch', '--show-current'],
    { cwd: input.projectPath },
  );

  if (currentBranch.trim() === input.branch) {
    throw new AppError('Cannot delete the currently checked-out branch', {
      code: 'GIT_CURRENT_BRANCH_DELETE',
      statusCode: 400,
    });
  }

  const deleteFlag = input.force ? '-D' : '-d';
  const { stdout } = await input.runCommand(
    'git',
    ['branch', deleteFlag, '--', input.branch],
    { cwd: input.projectPath },
  );
  return stdout;
}
