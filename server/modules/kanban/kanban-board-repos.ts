/**
 * The one check of the repository paths a board names.
 *
 * The paths come from a request, so every one is treated as hostile: never interpolated into a
 * shell (`execFileSync` takes an argv, and the path goes only in `cwd`), checked to be a real
 * directory, and checked by git itself rather than by looking for a `.git` entry. A worktree's
 * `.git` is a file, a submodule's lives elsewhere, and git is the authority on what a work tree is.
 *
 * Synchronous on purpose: a board PATCH is rare, and the check must finish before the write's
 * transaction opens. The dispatcher builds a board's cards in these directories, which is why a
 * path that is not a git work tree is refused at the door rather than discovered by a walk.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { AppError } from '@/shared/utils.js';

/**
 * The most repositories one board may name: a board is built in a handful of repos, and a list
 * longer than this is a mistake or an attack, not a board.
 */
export const KANBAN_BOARD_REPOS_MAX = 16;

/** A hung git on a network mount must not hold the request. */
const GIT_CHECK_TIMEOUT_MS = 5000;

/** One code for every refusal, so a caller shows the message and never branches on which rule failed. */
function refuse(message: string): AppError {
  return new AppError(message, { code: 'KANBAN_BOARD_REPO_INVALID', statusCode: 400 });
}

/** Node's fs errors carry their reason in `code`; the message text is not stable enough to match. */
function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

/**
 * The refusal message for a stat failure, or null when the code is one no path can cause. Every
 * code listed here comes from the path the caller typed, so each is a 400 naming that path.
 */
function statRefusal(code: string | undefined, shown: string): string | null {
  switch (code) {
    case 'ENOENT':
    case 'ENOTDIR':
      return `"${shown}" does not exist.`;
    case 'EACCES':
    case 'EPERM':
      return `"${shown}" cannot be read by the server.`;
    case 'ENAMETOOLONG':
    case 'ELOOP':
    case 'ERR_INVALID_ARG_VALUE':
      return `"${shown}" is not a valid path.`;
    default:
      return null;
  }
}

/**
 * Asks git, not the filesystem, whether a directory is a work tree. The path is only `cwd`, so no
 * shell ever reads it. Git exits non-zero outside a work tree, and that throw is the answer, not a
 * failure to report.
 */
function isInsideWorkTree(resolved: string): boolean {
  try {
    const output = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: resolved,
      encoding: 'utf8',
      timeout: GIT_CHECK_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Checks each repository path a board names and returns the list resolved and de-duplicated, in
 * first-seen order. The first path that fails is refused with a 400 that names it and says why.
 */
export function requireBoardRepos(paths: readonly string[]): string[] {
  if (paths.length > KANBAN_BOARD_REPOS_MAX) {
    throw refuse(`A board names at most ${KANBAN_BOARD_REPOS_MAX} repositories.`);
  }

  const seen = new Set<string>();
  const repos: string[] = [];

  for (const raw of paths) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) throw refuse('A repository path cannot be blank.');
    if (!path.isAbsolute(trimmed)) throw refuse(`"${trimmed}" is not an absolute path.`);

    const resolved = path.resolve(trimmed);

    let isDirectory: boolean;
    try {
      isDirectory = fs.statSync(resolved).isDirectory();
    } catch (error) {
      // Every code statRefusal maps comes from the path the caller typed, so each is a 400 that
      // names the path; only a code no path can cause (EIO, say) is the server's and must surface
      // as it is.
      const message = statRefusal(errorCode(error), trimmed);
      if (message === null) throw error;
      throw refuse(message);
    }
    if (!isDirectory) throw refuse(`"${trimmed}" is not a directory.`);
    if (!isInsideWorkTree(resolved)) throw refuse(`"${trimmed}" is not inside a git work tree.`);

    if (!seen.has(resolved)) {
      seen.add(resolved);
      repos.push(resolved);
    }
  }

  return repos;
}
