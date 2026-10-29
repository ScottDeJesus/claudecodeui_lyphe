import * as fs from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '@/shared/utils.js';

import { spawnAsync } from './git-command.service.js';
import { parseGitStatusOutput } from './git-parsing.service.js';
import {
  getCurrentBranchName,
  repositoryHasCommits,
  resolveRepositoryFilePath,
  validateGitRepository,
} from './git-repository.service.js';

type GitStatusReport = {
  branch: string;
  hasCommits: boolean;
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
  staged: string[];
};

type GitNotRepositoryAnswer = { notGitRepository: true; details: string };

// Helper function to strip git diff headers
function stripDiffHeaders(diff: string): string {
  if (!diff) return '';

  const lines = diff.split('\n');
  const filteredLines: string[] = [];
  let startIncluding = false;

  for (const line of lines) {
    // Skip all header lines including diff --git, index, file mode, and --- / +++ file paths
    if (line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('new file mode') ||
        line.startsWith('deleted file mode') ||
        line.startsWith('---') ||
        line.startsWith('+++')) {
      continue;
    }

    // Start including lines from @@ hunk headers onwards
    if (line.startsWith('@@') || startIncluding) {
      startIncluding = true;
      filteredLines.push(line);
    }
  }

  return filteredLines.join('\n');
}

/**
 * The git panel's status for a project directory the caller has already resolved to an ABSOLUTE path (the route does,
 * through `getActualProjectPath`; this reader does not check it, and a relative path would be taken against the server's
 * own working directory): branch, whether it has commits, and the changed files in the panel's five buckets. A directory outside any repository is an expected state, so it is
 * ANSWERED (`notGitRepository`, with the sentence that tells the user how to start one); every other failure throws.
 * Used by git.routes.ts's `/status` handler, and through the git barrel by the companion's read_git tool.
 */
export async function readGitStatus(projectPath: string): Promise<GitStatusReport | GitNotRepositoryAnswer> {
  try {
    // Validate git repository
    await validateGitRepository(projectPath);

    const branch = await getCurrentBranchName(projectPath);
    const hasCommits = await repositoryHasCommits(projectPath);

    const { stdout: statusOutput } = await spawnAsync('git', ['status', '--porcelain=v1', '-z'], { cwd: projectPath });
    const { modified, added, deleted, untracked, staged } = parseGitStatusOutput(statusOutput);

    return {
      branch,
      hasCommits,
      modified,
      added,
      deleted,
      untracked,
      staged,
    };
  } catch (error) {
    // `notGitRepository` lets the UI offer a one-click `git init`.
    if (error instanceof AppError && error.code === 'NOT_A_GIT_REPOSITORY') {
      return { notGitRepository: true, details: error.message };
    }
    throw error;
  }
}

/**
 * The git panel's diff text for one file of a project directory the caller has already resolved to an ABSOLUTE path
 * (as `readGitStatus` requires): an untracked file as additions, a deleted one as deletions, any other as its unstaged diff and, when that is empty, its staged
 * diff, each with git's file headers stripped. Throws on every failure, a directory outside any repository included.
 * Used by git.routes.ts's `/diff` handler, and through the git barrel by the companion's read_git tool.
 */
export async function readGitFileDiff(projectPath: string, file: string): Promise<string> {
  // Validate git repository
  await validateGitRepository(projectPath);

  const {
    repositoryRootPath,
    repositoryRelativeFilePath,
  } = await resolveRepositoryFilePath(projectPath, file);

  // Check if file is untracked or deleted
  const { stdout: statusOutput } = await spawnAsync(
    'git',
    ['status', '--porcelain', '--', repositoryRelativeFilePath],
    { cwd: repositoryRootPath },
  );
  const isUntracked = statusOutput.startsWith('??');
  const isDeleted = statusOutput.trim().startsWith('D ') || statusOutput.trim().startsWith(' D');

  let diff: string;
  if (isUntracked) {
    // For untracked files, show the entire file content as additions
    const filePath = path.join(repositoryRootPath, repositoryRelativeFilePath);
    const stats = await fs.stat(filePath);

    if (stats.isDirectory()) {
      // For directories, show a simple message
      diff = `Directory: ${repositoryRelativeFilePath}\n(Cannot show diff for directories)`;
    } else {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const lines = fileContent.split('\n');
      diff = `--- /dev/null\n+++ b/${repositoryRelativeFilePath}\n@@ -0,0 +1,${lines.length} @@\n` +
             lines.map(line => `+${line}`).join('\n');
    }
  } else if (isDeleted) {
    // For deleted files, show the entire file content from HEAD as deletions
    const { stdout: fileContent } = await spawnAsync(
      'git',
      ['show', `HEAD:${repositoryRelativeFilePath}`],
      { cwd: repositoryRootPath },
    );
    const lines = fileContent.split('\n');
    diff = `--- a/${repositoryRelativeFilePath}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n` +
           lines.map(line => `-${line}`).join('\n');
  } else {
    // Get diff for tracked files
    // First check for unstaged changes (working tree vs index)
    const { stdout: unstagedDiff } = await spawnAsync(
      'git',
      ['diff', '--', repositoryRelativeFilePath],
      { cwd: repositoryRootPath },
    );

    if (unstagedDiff) {
      // Show unstaged changes if they exist
      diff = stripDiffHeaders(unstagedDiff);
    } else {
      // If no unstaged changes, check for staged changes (index vs HEAD)
      const { stdout: stagedDiff } = await spawnAsync(
        'git',
        ['diff', '--cached', '--', repositoryRelativeFilePath],
        { cwd: repositoryRootPath },
      );
      diff = stripDiffHeaders(stagedDiff) || '';
    }
  }

  return diff;
}
