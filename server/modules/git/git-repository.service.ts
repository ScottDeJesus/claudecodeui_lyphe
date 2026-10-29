import * as fs from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '@/shared/utils.js';

import { type GitCommandFailure, spawnAsync } from './git-command.service.js';

type RepositoryFilePath = {
  repositoryRootPath: string;
  repositoryRelativeFilePath: string;
};

function validateFilePath(file: string, projectPath?: string): string {
  if (!file || file.includes('\0')) {
    throw new Error('Invalid file path');
  }
  // Prevent path traversal: resolve the file relative to the project root
  // and ensure the result stays within the project directory
  if (projectPath) {
    const resolved = path.resolve(projectPath, file);
    const normalizedRoot = path.resolve(projectPath) + path.sep;
    if (!resolved.startsWith(normalizedRoot) && resolved !== path.resolve(projectPath)) {
      throw new Error('Invalid file path: path traversal detected');
    }
  }
  return file;
}

function getGitErrorDetails(error: unknown): string {
  const failure = error as GitCommandFailure | undefined;
  return `${failure?.message || ''} ${failure?.stderr || ''} ${failure?.stdout || ''}`;
}

function isMissingHeadRevisionError(error: unknown): boolean {
  const errorDetails = getGitErrorDetails(error).toLowerCase();
  return errorDetails.includes('unknown revision')
    || errorDetails.includes('ambiguous argument')
    || errorDetails.includes('needed a single revision')
    || errorDetails.includes('bad revision');
}

/**
 * Throws an `AppError` coded NOT_A_GIT_REPOSITORY when the directory is outside any work tree, and a
 * plain Error when the directory is missing or git fails otherwise.
 * Used by git.routes.ts, whose handlers all guard on it, and by git-status.service.ts's two readers.
 */
export async function validateGitRepository(projectPath: string): Promise<void> {
  try {
    // Check if directory exists
    await fs.access(projectPath);
  } catch {
    throw new Error(`Project path not found: ${projectPath}`);
  }

  try {
    // Allow any directory that is inside a work tree (repo root or nested folder).
    const { stdout: insideWorkTreeOutput } = await spawnAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectPath });
    const isInsideWorkTree = insideWorkTreeOutput.trim() === 'true';
    if (!isInsideWorkTree) {
      throw new AppError('Not a git repository', {
        code: 'NOT_A_GIT_REPOSITORY',
        statusCode: 400,
      });
    }

    // Ensure git can resolve the repository root for this directory.
    await spawnAsync('git', ['rev-parse', '--show-toplevel'], { cwd: projectPath });
  } catch (error) {
    if (
      error instanceof AppError
      && error.code === 'NOT_A_GIT_REPOSITORY'
    ) {
      throw error;
    }

    if (/not a git repository/i.test(getGitErrorDetails(error))) {
      throw new AppError('Not a git repository. Initialize a git repository with "git init" to use source control features.', {
        code: 'NOT_A_GIT_REPOSITORY',
        statusCode: 400,
      });
    }

    throw error;
  }
}

/** Used by git.routes.ts's remote-status, fetch, pull, push and publish handlers, and by `readGitStatus`. */
export async function getCurrentBranchName(projectPath: string): Promise<string> {
  try {
    // symbolic-ref works even when the repository has no commits.
    const { stdout } = await spawnAsync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: projectPath });
    const branchName = stdout.trim();
    if (branchName) {
      return branchName;
    }
  } catch {
    // Fall back to rev-parse for detached HEAD and older git edge cases.
  }

  const { stdout } = await spawnAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectPath });
  return stdout.trim();
}

/** Used by git.routes.ts's unstage and remote-status handlers, and by `readGitStatus`. */
export async function repositoryHasCommits(projectPath: string): Promise<boolean> {
  try {
    await spawnAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: projectPath });
    return true;
  } catch (error) {
    if (isMissingHeadRevisionError(error)) {
      return false;
    }
    throw error;
  }
}

/** Used by git.routes.ts's commit, stage, unstage and generate-commit-message handlers, by `resolveRepositoryFilePath`, and through the git barrel by the companion's read_git tool. */
export async function getRepositoryRootPath(projectPath: string): Promise<string> {
  const { stdout } = await spawnAsync('git', ['rev-parse', '--show-toplevel'], { cwd: projectPath });
  return stdout.trim();
}

/**
 * The size in bytes of a file as HEAD holds it (`git cat-file -s HEAD:<path>`, run at the repository root, so `repositoryRelativePath`
 * is a path as `git status` prints it), or `null` when HEAD holds none: a repository with no commits, or a path that is not in HEAD.
 * Reads the object's header, never its content. Used through the git barrel by the companion's read_git tool, which asks before
 * `readGitFileDiff` reads a DELETED file whole from `git show`.
 */
export async function readHeadFileSize(repositoryRootPath: string, repositoryRelativePath: string): Promise<number | null> {
  try {
    const { stdout } = await spawnAsync('git', ['cat-file', '-s', `HEAD:${repositoryRelativePath}`], { cwd: repositoryRootPath });
    const bytes = Number(stdout.trim());
    return Number.isFinite(bytes) ? bytes : null;
  } catch {
    // git refuses a path HEAD does not hold; that is the answer, not a fault.
    return null;
  }
}

function normalizeRepositoryRelativeFilePath(filePath: string): string {
  return String(filePath)
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .trim();
}

function parseStatusFilePaths(statusOutput: string): string[] {
  return statusOutput
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .map((line) => {
      const statusPath = line.substring(3);
      const renamedFilePath = statusPath.split(' -> ')[1];
      return normalizeRepositoryRelativeFilePath(renamedFilePath || statusPath);
    })
    .filter(Boolean);
}

function buildFilePathCandidates(projectPath: string, repositoryRootPath: string, filePath: string): string[] {
  const normalizedFilePath = normalizeRepositoryRelativeFilePath(filePath);
  const projectRelativePath = normalizeRepositoryRelativeFilePath(path.relative(repositoryRootPath, projectPath));
  const candidates = [normalizedFilePath];

  if (
    projectRelativePath
    && projectRelativePath !== '.'
    && !normalizedFilePath.startsWith(`${projectRelativePath}/`)
  ) {
    candidates.push(`${projectRelativePath}/${normalizedFilePath}`);
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

/**
 * Maps a path the panel sent (project-relative, repository-relative, or a bare file name) to the
 * repository root and the path git knows the file by.
 * Used by git.routes.ts's file-with-diff, commit, stage, unstage, generate-commit-message, discard and
 * delete-untracked handlers, and by git-status.service.ts's `readGitFileDiff`.
 */
export async function resolveRepositoryFilePath(projectPath: string, filePath: string): Promise<RepositoryFilePath> {
  validateFilePath(filePath);

  const repositoryRootPath = await getRepositoryRootPath(projectPath);
  const candidateFilePaths = buildFilePathCandidates(projectPath, repositoryRootPath, filePath);

  for (const candidateFilePath of candidateFilePaths) {
    const { stdout } = await spawnAsync('git', ['status', '--porcelain', '--', candidateFilePath], { cwd: repositoryRootPath });
    if (stdout.trim()) {
      return {
        repositoryRootPath,
        repositoryRelativeFilePath: candidateFilePath,
      };
    }
  }

  // If the caller sent a bare filename (e.g. "hello.ts"), recover it from changed files.
  const normalizedFilePath = normalizeRepositoryRelativeFilePath(filePath);
  if (!normalizedFilePath.includes('/')) {
    const { stdout: repositoryStatusOutput } = await spawnAsync('git', ['status', '--porcelain'], { cwd: repositoryRootPath });
    const changedFilePaths = parseStatusFilePaths(repositoryStatusOutput);
    const suffixMatches = changedFilePaths.filter(
      (changedFilePath) => changedFilePath === normalizedFilePath || changedFilePath.endsWith(`/${normalizedFilePath}`),
    );

    if (suffixMatches.length === 1) {
      return {
        repositoryRootPath,
        repositoryRelativeFilePath: suffixMatches[0],
      };
    }
  }

  return {
    repositoryRootPath,
    repositoryRelativeFilePath: candidateFilePaths[0],
  };
}
