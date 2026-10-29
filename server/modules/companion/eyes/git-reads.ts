import { stat } from 'node:fs/promises';
import path from 'node:path';

import { getRepositoryRootPath, readGitFileDiff, readGitStatus, readHeadFileSize } from '@/modules/git/index.js';
import { textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import { isDeniedPath } from '../tools/dactyl-paths.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';
import { resolveProject, type HisProject } from '../tools/house-reads.js';

import { answerRead, cappedLines } from './eyes-answer.js';
import {
  changedFilesOf,
  DIFF_OF_ONE_MAX_CHARACTERS,
  diffSection,
  diffShareFor,
  fileLine,
  filesNamedBy,
  GIT_FILES_MAX,
  noteSection,
  READ_MAX_BYTES,
  relativeScope,
  shownPath,
  statusSentence,
  withheldSentence,
  type ChangedFile,
  type GitStatusOfRepository,
} from './git-lines.js';
import { counted } from './line-words.js';

/**
 * `read_git`: a project's uncommitted work, read through the git panel's own readers (`readGitStatus`, `readGitFileDiff`: the
 * same bodies the panel's `/status` and `/diff` routes run), for the project as she names it (`resolveProject`). `scope` is:
 *   - `status`: "On <branch>: <n> modified, …", then `<state> <path>` per changed file, thirty at most;
 *   - `diff`: the diff of every changed file (thirty at most), rendered and handed to a dactyl under a fixed brief when long;
 *   - a changed file's path, or the end of one: that file's diff, whole when short and a dactyl's digest when long.
 * A folder that is no repository, or is gone, says so. Only files `git status` lists are ever read — a scope is matched against
 * them, never opened as a path of its own.
 *
 * A SECRET'S DIFF MUST NOT REACH HER CONTEXT OR A DACTYL. Every file is held to the dactyl deny rule (`isDeniedPath`, the rule
 * `ask_dactyl` holds a path to, on the name and on the real file) BEFORE its diff is read: a denied file is named as withheld and
 * its diff is never read — not for `diff`, not by its path. (An untracked file's diff is the whole file, so reading it would be
 * reading the secret.) `git status` prints paths relative to the REPOSITORY ROOT, which is not the project folder when the project is
 * a subfolder of its repository, so the rule is judged on the root joined with git's path (`getRepositoryRootPath`): on the
 * project folder a link above it, or a place rule, would be judged on a path that does not exist. A credential-looking value inside
 * a diff of an ordinary file is masked (`diffSection`), and a file's name is folded to one line wherever it is shown.
 *
 * THE READ IS BOUNDED. A git that does not answer must not hold a voice turn: the whole read ends when her turn is stopped or after
 * `GIT_READ_BOUND_MS`, whichever is first, and says so. The bound is a race, not a kill: `readGitStatus` and `readGitFileDiff` are
 * the panel's own and take no signal, so a git child that is stuck runs on until it ends by itself. A file of
 * `READ_MAX_BYTES` or more that the reader would read whole (an untracked or added file, a deleted file's blob in HEAD) is not asked
 * for; a large file with a modified line is read as its hunks.
 *
 * Consumed by `house-reads.ts`, which builds the tool.
 */

/** What a dactyl is asked of a long diff, and of one file's. (`NO_SPEND` is added by `wholeOrDigest`.) */
const DIFF_BRIEF = 'What does this uncommitted work change, file by file? At most 15 lines; cite L<n>.';
const FILE_BRIEF = 'What does this change do to the file, hunk by hunk? At most 12 lines; cite L<n>.';
const STATUS_BRIEF = 'Which files are changed, and in what state? At most 15 lines; cite L<n>.';

/** How long one `read_git` call may spend on git, all its calls together. Long enough for a status of a large repository and thirty diffs. */
const GIT_READ_BOUND_MS = 60_000;

/** The read as it runs: the project, its repository's root and the signal that ends the read (her stop, or the bound). */
type Repo = { project: HisProject; root: string; bound: AbortSignal };

/** Thrown by `within` when the read's signal fired before git answered. */
class GitReadEnded extends Error {}

/** `work` raced against the read's signal: it settles with `work`, or rejects `GitReadEnded` the moment the signal fires. */
function within<T>(work: Promise<T>, bound: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (bound.aborted) {
      // The call already started; its answer will never be read, so its failure must not go unhandled.
      work.catch(() => undefined);
      reject(new GitReadEnded('The read had ended.'));
      return;
    }
    const onEnd = () => reject(new GitReadEnded('The read ended before git answered.'));
    bound.addEventListener('abort', onEnd, { once: true });
    work.then(resolve, reject).finally(() => bound.removeEventListener('abort', onEnd));
  });
}

/** Whether a changed file would be withheld: its path in the repository, held to the dactyl deny rule. */
const isWithheld = (repo: Repo, file: ChangedFile): boolean => isDeniedPath(path.join(repo.root, file.path));

/**
 * The size of a changed file when reading its diff would read the FILE, and it is `READ_MAX_BYTES` or more; else `null`. The gate
 * keys on what the panel's reader does, not on every file: an untracked file is read whole (`fs.readFile`) and an added one's
 * diff IS the whole file, so both are sized from the disk; a deleted file is read whole from `git show HEAD:<path>`, so it is
 * sized from its blob in HEAD (`readHeadFileSize`, the object's header only). A MODIFIED file runs `git diff`, whose output is the
 * hunks, so a large document with a one-line change is read as that line. `null` also when there is nothing to measure (the
 * reader answers for itself).
 */
async function oversizeBytes(repo: Repo, file: ChangedFile): Promise<number | null> {
  if (file.state === 'modified') return null;
  if (file.state === 'deleted') {
    const bytes = await within(readHeadFileSize(repo.root, file.path), repo.bound);
    return bytes !== null && bytes >= READ_MAX_BYTES ? bytes : null;
  }
  try {
    const stats = await stat(path.join(repo.root, file.path));
    return stats.isFile() && stats.size >= READ_MAX_BYTES ? stats.size : null;
  } catch {
    return null;
  }
}

/** One changed file's section: its diff through the panel's reader, or the note that it is too large to diff here. */
async function sectionOf(repo: Repo, file: ChangedFile, maxCharacters: number): Promise<string> {
  const bytes = await oversizeBytes(repo, file);
  if (bytes !== null) return noteSection(file, `a file of ${Math.round(bytes / 1_000_000)} MB is too large to diff here; open it in the git panel`);
  return diffSection(file, await within(readGitFileDiff(repo.project.path, file.path), repo.bound), maxCharacters);
}

/** `status`: the sentence, then a line per changed file (thirty at most), the withheld ones marked. */
function statusAnswer(deps: CompanionToolDeps, repo: Repo, status: GitStatusOfRepository, files: ChangedFile[], panel: boolean, signal: AbortSignal | undefined) {
  const lines = files.map((file) => fileLine(file, isWithheld(repo, file)));
  const text = [statusSentence(status), files.length === 0 ? 'Nothing is uncommitted.' : cappedLines(lines, GIT_FILES_MAX)].join('\n');
  return answerRead(deps, { panel, title: `${repo.project.name}: uncommitted work`, text, label: 'git-status', brief: STATUS_BRIEF, intro: '' }, signal);
}

/**
 * `diff`: every changed file's diff (thirty at most), the withheld ones named and not read, a file that cannot be read said so. A
 * read that git stops answering (the bound) hands over what it has and says how many files it did not reach; one that her stop
 * ended is thrown on, for `readGit` to answer.
 */
async function diffAnswer(deps: CompanionToolDeps, repo: Repo, files: ChangedFile[], panel: boolean, signal: AbortSignal | undefined) {
  const read = files.slice(0, GIT_FILES_MAX);
  const share = diffShareFor(read.length);
  const sections: string[] = [];
  const withheld: string[] = [];
  let notReached = 0;
  for (const [index, file] of read.entries()) {
    if (isWithheld(repo, file)) {
      withheld.push(shownPath(file.path));
      continue;
    }
    try {
      sections.push(await sectionOf(repo, file, share));
    } catch (error) {
      if (error instanceof GitReadEnded) {
        if (signal?.aborted) throw error;
        notReached = read.length - index;
        break;
      }
      console.error(`[Companion] read_git could not read the diff of ${file.path}`, error);
      sections.push(noteSection(file, 'its diff could not be read just now'));
    }
  }
  const intro = [
    `${repo.project.name}: ${counted(files.length, 'changed file')}${files.length > read.length ? `, the first ${read.length} read; name a file's path for another` : ''}.`,
    withheld.length > 0 ? `Withheld, never read (a secret by its name or place): ${withheld.join(', ')}.` : '',
    notReached > 0 ? `Git stopped answering; ${counted(notReached, 'file')} of these ${notReached === 1 ? 'was' : 'were'} not reached.` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
  return answerRead(deps, { panel, title: `${repo.project.name}: uncommitted diff`, text: sections.join('\n\n'), label: 'git-diff', brief: DIFF_BRIEF, intro }, signal);
}

/** A changed file's path (or the end of one): its diff, or the sentence that says which files fit, none, or that it is withheld. */
async function fileAnswer(deps: CompanionToolDeps, repo: Repo, files: ChangedFile[], scope: string, panel: boolean, signal: AbortSignal | undefined) {
  const wanted = relativeScope(repo.root, scope);
  // The name is judged first, changed or not: a `.env` is refused as a `.env` whether or not git lists it. As it stands against the
  // repository's root and against the project folder, since she may name the path from either.
  if ([repo.root, repo.project.path].some((base) => isDeniedPath(path.join(base, wanted)))) return deps.refuse(withheldSentence(wanted));
  const found = filesNamedBy(files, wanted);
  if (found.length === 0) return textResult(`No uncommitted change touches "${scope}" in ${repo.project.name}. Scope status lists the changed files.`);
  if (found.length > 1) {
    return deps.refuse(`"${scope}" fits ${found.length} changed files:\n${cappedLines(found.map((file) => fileLine(file, false)))}\nName the path of the one meant.`);
  }
  const [file] = found;
  if (isWithheld(repo, file)) return deps.refuse(withheldSentence(file.path));
  const diff = await sectionOf(repo, file, DIFF_OF_ONE_MAX_CHARACTERS);
  return answerRead(deps, { panel, title: `${repo.project.name}: ${file.path}`, text: diff, label: 'git-file', brief: FILE_BRIEF, intro: '' }, signal);
}

/** Whether `folder` is a folder on disk: a registered project can outlive its folder (the project list keeps it). */
async function isFolder(folder: string): Promise<boolean> {
  try {
    return (await stat(folder)).isDirectory();
  } catch {
    return false;
  }
}

/** The sentence for a read that ended before git answered: her stop, or the bound. A refusal, because nothing was read. */
function endedSentence(stopped: boolean): string {
  return stopped
    ? 'The read was stopped before git answered.'
    : `Git did not answer within ${GIT_READ_BOUND_MS / 1000} seconds, so nothing of this project was read. Tell him it is not answering, or name one file's path.`;
}

/** `read_git`: see the file's head. A project that cannot be resolved is the resolver's own sentence. */
export async function readGit(
  deps: CompanionToolDeps,
  args: { project: string; scope: string; panel?: boolean },
  signal: AbortSignal | undefined
): Promise<ToolTextResult> {
  const resolved = resolveProject(args.project);
  if (!resolved.ok) return deps.refuse(resolved.sentence);
  const { project } = resolved;
  if (!(await isFolder(project.path))) {
    return textResult(`${project.name} is registered, but its folder is not there (${project.path}), so there is no uncommitted work to read.`);
  }

  const bound = AbortSignal.any(signal === undefined ? [AbortSignal.timeout(GIT_READ_BOUND_MS)] : [AbortSignal.timeout(GIT_READ_BOUND_MS), signal]);
  try {
    const status = await within(readGitStatus(project.path), bound);
    if ('notGitRepository' in status) return textResult(`${project.name} is not a git repository, so it has no uncommitted work to read.`);

    const repo: Repo = { project, root: await within(getRepositoryRootPath(project.path), bound), bound };
    const files = changedFilesOf(status);
    const scope = args.scope.trim();
    const panel = args.panel === true;
    if (scope.toLowerCase() === 'status') return await statusAnswer(deps, repo, status, files, panel, signal);
    if (files.length === 0) return textResult(`${project.name} is clean on ${status.branch}: nothing is uncommitted.`);
    if (scope.toLowerCase() === 'diff') return await diffAnswer(deps, repo, files, panel, signal);
    return await fileAnswer(deps, repo, files, scope, panel, signal);
  } catch (error) {
    if (error instanceof GitReadEnded) return deps.refuse(endedSentence(signal?.aborted === true));
    throw error;
  }
}
