import path from 'node:path';

import type { readGitStatus } from '@/modules/git/index.js';

import { maskCredentials } from './line-words.js';

/**
 * The git panel's words, for `read_git` (`git-reads.ts`, built into a tool by `house-reads.ts`): the changed files of a project's uncommitted work as lines, and the
 * ways a scope names one of them. PURE — no git, no file system: the status and each diff arrive as values, and the file a deny
 * rule would withhold is told to these functions by the caller (`isDeniedPath` has to look at the disk).
 *
 * The files come from the git panel's own status (`readGitStatus`), so the buckets are the panel's: git's `modified`, `added`,
 * `deleted` and `untracked`, with `staged` laid over them (a staged file is also in one of the first three). A file is one line,
 * `<state> <path>`, and a staged one ends ` · staged`.
 *
 * Consumer: `git-reads.ts` (`read_git`). Every export below is read there; none is read anywhere else.
 */

/** What a status read answers when the folder is a repository: the branch, whether it has commits, and the five buckets. */
export type GitStatusOfRepository = Extract<Awaited<ReturnType<typeof readGitStatus>>, { branch: string }>;

/** One changed file: its path as git prints it (relative to the REPOSITORY ROOT, which is not the project folder when the project is a subfolder), its state in the panel's four words, and whether it is staged. */
export type ChangedFile = { path: string; state: 'modified' | 'added' | 'deleted' | 'untracked'; staged: boolean };

/** The most files `status` lists and `diff` reads: a project with a hundred changes is narrowed by a path, not read whole. */
export const GIT_FILES_MAX = 30;

/**
 * How much of a diff is rendered. An untracked generated file is read whole by the panel's reader and a reader takes a bounded
 * window, so a diff is cut at a line. ONE file asked for by its path keeps up to `DIFF_OF_ONE_MAX_CHARACTERS`. When many files are
 * digested together (`diff`), the reader wants a gist of each, so the whole render is held near `DIFF_OF_MANY_TOTAL_CHARACTERS`
 * (each file gets an equal share, never less than 1,000 nor more than 6,000): a hundred kilobytes of hunks to answer fifteen lines
 * took a reader past its three-minute bound. Consumed by `git-reads.ts`, through `diffShareFor`.
 */
export const DIFF_OF_ONE_MAX_CHARACTERS = 40_000;
const DIFF_OF_MANY_TOTAL_CHARACTERS = 30_000;
const DIFF_SHARE_MIN_CHARACTERS = 1_000;
const DIFF_SHARE_MAX_CHARACTERS = 6_000;

/** The characters each file of `fileCount` may take of a digested `diff` (see `DIFF_OF_MANY_TOTAL_CHARACTERS`). */
export function diffShareFor(fileCount: number): number {
  return Math.min(DIFF_SHARE_MAX_CHARACTERS, Math.max(DIFF_SHARE_MIN_CHARACTERS, Math.floor(DIFF_OF_MANY_TOTAL_CHARACTERS / Math.max(1, fileCount))));
}

/** The changed files of a status, in the panel's order (modified, added, deleted, untracked), each once. */
export function changedFilesOf(status: GitStatusOfRepository): ChangedFile[] {
  const staged = new Set(status.staged);
  const buckets: Array<[ChangedFile['state'], string[]]> = [
    ['modified', status.modified],
    ['added', status.added],
    ['deleted', status.deleted],
    ['untracked', status.untracked],
  ];
  const seen = new Set<string>();
  const files: ChangedFile[] = [];
  for (const [state, paths] of buckets) {
    for (const filePath of paths) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      files.push({ path: filePath, state, staged: staged.has(filePath) });
    }
  }
  return files;
}

/** "On main: 3 modified, 1 added, 0 deleted, 2 untracked, 1 staged." — the counts are the panel's buckets, not the length of the file list. */
export function statusSentence(status: GitStatusOfRepository): string {
  const branch = status.hasCommits ? status.branch : `${status.branch} (no commits yet)`;
  return `On ${branch}: ${status.modified.length} modified, ${status.added.length} added, ${status.deleted.length} deleted, ${status.untracked.length} untracked, ${status.staged.length} staged.`;
}

/**
 * A path as a LINE shows it: every line break (and any other whitespace run) folded to one space. A file name is whatever its maker
 * typed, and a repository he registered may be a clone, so a name holding a line break must not start a line of its own in an
 * answer. Only the display is folded; matching and reading use the path git printed. Consumed here by every line that carries one,
 * and by `git-reads.ts` for the names it lists as withheld.
 */
export function shownPath(filePath: string): string {
  return filePath.replace(/[\s\u0085]+/g, ' ');
}

/** The refusal that names a file the deny rule withholds and says its diff is never read. */
export function withheldSentence(filePath: string): string {
  return `${shownPath(filePath)} is withheld: its name or place marks it as a secret, so its diff is never read, by her or by a reader. Tell him it is his to open.`;
}

/** One file as a status line: `<state> <path>`, ` · staged` when it is, and ` · withheld` when its diff would not be read. */
export function fileLine(file: ChangedFile, withheld: boolean): string {
  return `${file.state} ${shownPath(file.path)}${file.staged ? ' · staged' : ''}${withheld ? ' · withheld (a secret by its name)' : ''}`;
}

/** A changed file's section header, `=== <state> <path>`. */
const sectionHeader = (file: ChangedFile): string => `=== ${file.state} ${shownPath(file.path)}${file.staged ? ' (staged)' : ''}`;

/**
 * A file this large (in bytes) is not diffed when the panel's reader would read the FILE whole (an untracked or added file, a
 * deleted file's blob), so the eyes size it first and leave it unread. Consumed by `git-reads.ts`.
 */
export const READ_MAX_BYTES = 2_000_000;

/** A section that says why a file has no diff here (too large, could not be read): its header, then the note in brackets. Consumed by `git-reads.ts`. */
export function noteSection(file: ChangedFile, note: string): string {
  return `${sectionHeader(file)}\n(${note})`;
}

/**
 * A file's diff as one section of the rendered text: a header line, then the diff. A diff with a NUL character is a binary file
 * and is not shown; a diff past `maxCharacters` is cut at a line, saying how many lines were left out. An empty diff says so (a
 * file whose only change is its mode, or one the panel cannot diff). A credential-looking value in the diff (a named secret, a
 * `Bearer` value, a vendor key's own prefix: `maskCredentials`, the mask every eyes read puts on stored text) is replaced by
 * `<masked>` before the diff is cut, so the cut cannot leave half of one. That is a net, not a promise: a secret in an ordinary file
 * under no recognisable shape reaches her, as it reaches an `ask_dactyl` reader.
 */
export function diffSection(file: ChangedFile, rawDiff: string, maxCharacters: number): string {
  const header = sectionHeader(file);
  if (rawDiff.includes('\u0000')) return `${header}\n(a binary file; its diff is not shown)`;
  const diff = maskCredentials(rawDiff);
  if (diff.trim() === '') return `${header}\n(no text changes to show)`;
  if (diff.length <= maxCharacters) return `${header}\n${diff}`;
  const lines = diff.split('\n');
  const kept: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length + 1 > maxCharacters) break;
    kept.push(line);
    size += line.length + 1;
  }
  return `${header}\n${kept.join('\n')}\n… ${lines.length - kept.length} more lines of this diff are not shown`;
}

/**
 * The scope as a path relative to the repository root, the way git prints one: a path under the root is taken relative to it, a
 * leading `./` is dropped, and the slashes are the repository's. Anything else is returned as written, which then matches by its tail
 * (`read_git`'s scope may be the end of a path, as he says one, or a path relative to a project that is a subfolder).
 */
export function relativeScope(rootPath: string, scope: string): string {
  const given = scope.trim().replace(/^\.\//, '');
  if (path.isAbsolute(given)) {
    const relative = path.relative(rootPath, given);
    if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative.split(path.sep).join('/');
  }
  return given;
}

/**
 * The changed files a scope names: the one whose path equals it, else those whose path ends with it at a folder boundary
 * (`git-lines.ts` for `server/…/git-lines.ts`), else those that hold it anywhere in the path (case-insensitive). The first rung
 * that finds any is the answer, so an exact path is never confused by a longer one that contains it.
 */
export function filesNamedBy(files: ChangedFile[], scope: string): ChangedFile[] {
  const wanted = scope.toLowerCase();
  const rungs: Array<(file: ChangedFile) => boolean> = [
    (file) => file.path.toLowerCase() === wanted,
    (file) => file.path.toLowerCase().endsWith(`/${wanted}`),
    (file) => file.path.toLowerCase().includes(wanted),
  ];
  for (const matches of rungs) {
    const found = files.filter(matches);
    if (found.length > 0) return found;
  }
  return [];
}
