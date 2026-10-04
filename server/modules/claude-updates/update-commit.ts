/**
 * The commit step: the one place this pipeline writes to git history, and the four guards that decide
 * whether it may.
 *
 * An Agent SDK install rewrites `package.json` and `package-lock.json` in a working tree somebody is
 * working in, so "commit the update" is a claim about two files that may hold hunks the pipeline
 * never wrote. INV-100 is the rule that makes the claim safe (`git commit -- <path>` commits the FULL
 * working-tree content of each named path): the commit names those two paths and nothing else, and it
 * runs only when both were clean against HEAD when the job started AND still hash exactly as the
 * runner left them. Either test failing is a `skipped` step carrying the reason — never a commit that
 * sweeps up a stranger's work.
 *
 * The commit runs with the repository's own hooks and is never pushed. This is a working tree, not a
 * release: what happens to the commit after it exists is the person's business.
 *
 * The step is mutated in place, like every other step a writer touches here, and the file is written
 * by the caller — one pass of the reconciler is one write.
 */

import type { ClaudeUpdateJob, ClaudeUpdateStep } from '@/shared/claude-update-types.js';

import { packageRow } from './packages.js';
import type { RunGit } from './update-git.js';
import { PACKAGE_FILES, hashPackageFiles } from './update-job.js';

/** What the step needs besides the job: the repository root, and the one way this module asks git. */
type CommitDependencies = {
  appRoot: string;
  runGit: RunGit;
};

/** The step's verdict, written the way every other step verdict is: the state, the one line, and the
 *  moment it ended. Returned, so the caller reads the outcome without looking it up again. */
function endStep(step: ClaudeUpdateStep, state: 'done' | 'failed' | 'skipped', detail: string): ClaudeUpdateStep {
  step.state = state;
  step.detail = detail;
  step.endedAt = Date.now();
  return step;
}

/** The first line git printed on stderr — where a refusal is — or a sentence saying it printed none. */
function firstStderrLine(stderr: string): string {
  return stderr.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? 'git said nothing';
}

/**
 * The commit's message. One subject line naming the package and both versions, in the word the job's
 * own kind asks for: an update BUMPS to the version it installed, a rollback goes back to the one the
 * update came from. Both versions are the step's own — the commit is about that move, not about the
 * versions on disk when it happens to run.
 */
function commitMessage(job: ClaudeUpdateJob, commit: ClaudeUpdateStep): string {
  const verb = job.kind === 'rollback' ? 'roll back' : 'bump';
  const name = packageRow('sdk').name;
  return `chore(deps): ${verb} ${name} from ${commit.from ?? 'not known'} to ${commit.to ?? 'not known'}`;
}

/**
 * Runs the commit step's guards in order and answers the step as it now stands.
 *
 * The two guards that end in `skipped` are not failures: the update itself landed, and these two
 * files are the person's to keep. A git that refuses is the one `failed` — and it is the person's
 * too, because a commit hook that said no is a decision, not a malfunction.
 */
export async function runCommitStep(job: ClaudeUpdateJob, dependencies: CommitDependencies): Promise<ClaudeUpdateStep> {
  const commit = job.steps.find((step) => step.key === 'commit');
  // Unreachable from typed callers: `createJob` gives a commit step to exactly the jobs that have an
  // sdk step, and only those are ever walked here. A job without one is a file this build cannot
  // drive, and committing anything on its behalf would be inventing what it asked for.
  if (commit === undefined) throw new Error('the job has no commit step to run');

  if (!job.packageFiles.cleanAtStart) {
    return endStep(
      commit,
      'skipped',
      'package.json or package-lock.json had uncommitted changes when the update started — left for you to commit',
    );
  }

  // The hashes the runner took the moment its install landed. A null — a job written before that
  // moment, or a hand-edit — compares unequal to anything, and the safe direction for a pathspec
  // commit is the one where it does not happen (INV-100).
  const after = job.packageFiles.hashesAfterInstall;
  const now = hashPackageFiles(dependencies.appRoot);
  if (after === null || now.packageJson !== after.packageJson || now.packageLock !== after.packageLock) {
    return endStep(commit, 'skipped', 'package.json or package-lock.json changed after the install — left uncommitted');
  }

  const result = await dependencies.runGit([
    'commit',
    '-m',
    commitMessage(job, commit),
    '--',
    ...PACKAGE_FILES,
  ]);
  if (result.code !== 0) return endStep(commit, 'failed', firstStderrLine(result.stderr));

  // The commit exists; its short hash is the receipt a person can look up. A rev-parse that fails
  // says nothing about the commit, so it costs the sentence its hash and not the step its `done`.
  const head = await dependencies.runGit(['rev-parse', '--short', 'HEAD']);
  const short = head.code === 0 ? head.stdout.trim() : '';
  return endStep(commit, 'done', short === '' ? 'committed' : `committed ${short}`);
}
