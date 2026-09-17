import fs from 'node:fs';
import path from 'node:path';

import { readRegistry } from './universe-registry.service.js';

/**
 * What each repo's HEAD reads as, read from the files git keeps it in.
 *
 * This is the CAUSE of a new map, watched directly, and the alternative — shelling `git rev-parse`
 * on a timer — is a process per repo per tick on the event loop that carries every chat websocket
 * in this app, to learn something two small file reads already say. The reading below is the same
 * sha that command prints: `.git/HEAD` names a ref, and the ref file holds the sha.
 *
 * Two gaps are real and both are covered rather than hoped away: a repo that has been `gc`'d has no
 * loose ref at all and keeps its branches in `packed-refs`, and a linked worktree keeps its own
 * HEAD in a git dir reached through a `.git` FILE, with its branch refs in the common git dir that
 * `commondir` names. A repo whose HEAD cannot be read reports `null` for itself and never throws —
 * one unreadable repo is not a reason for the other three to stop being watched, and a lane that
 * dies on the first bad path stops announcing every map.
 */

/** A full sha, which is all any branch ref in either location can be. */
const SHA = /^[0-9a-f]{40}$/;

/** `gitdir: <path>` — the whole content of a worktree's `.git` file, relative or absolute. */
const GITDIR_LINE = /^gitdir:\s*(.+)$/;

/** What a repo's HEAD reads as, or `null` when it could not be read. */
export type RepoHeads = Record<string, string | null>;

/** One file's trimmed content, or `null` for anything that is not a readable file. */
function readTrimmed(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * The `packed-refs` line for one ref: `<sha> <ref>` for a branch, and `^<sha>` peel lines for tags,
 * which are skipped by not matching the ref name. `null` when the ref is not packed.
 */
function packedRef(gitDir: string, ref: string): string | null {
  const packed = readTrimmed(path.join(gitDir, 'packed-refs'));
  if (packed === null) return null;
  for (const line of packed.split('\n')) {
    const [sha, name] = line.split(' ');
    if (name === ref && SHA.test(sha)) return sha;
  }
  return null;
}

/**
 * Where a repo's HEAD and its refs live, which are the same directory for a main checkout and two
 * different ones for a linked worktree.
 *
 * `.git` is a directory, or a FILE naming the git dir git keeps for that worktree. A worktree's own
 * HEAD lives there — but its BRANCH refs do not: they live in the common git dir that `<gitdir>/`
 * `commondir` names (relative, and usually `../..`), alongside `packed-refs` and `objects`. Reading
 * a worktree's branch ref out of its own git dir finds nothing, every tick, forever — which is the
 * same failure as a `gc`'d repo, arriving through a different door. A worktree's git dir carries
 * `commondir` only when it is a linked one; a main checkout has none and both are its git dir.
 */
function gitDirsOf(repoPath: string): { headDir: string; refDir: string } {
  const dotGit = path.join(repoPath, '.git');
  let headDir = dotGit;
  try {
    if (!fs.statSync(dotGit).isDirectory()) {
      const named = GITDIR_LINE.exec(readTrimmed(dotGit) ?? '')?.[1].trim();
      if (named !== undefined) headDir = path.resolve(repoPath, named);
    }
  } catch {
    return { headDir, refDir: headDir };
  }
  const common = readTrimmed(path.join(headDir, 'commondir'));
  return { headDir, refDir: common === null ? headDir : path.resolve(headDir, common) };
}

function readRepoHead(repoPath: string): string | null {
  const { headDir, refDir } = gitDirsOf(repoPath);
  const head = readTrimmed(path.join(headDir, 'HEAD'));
  if (head === null) return null;
  // A detached HEAD holds the sha directly; anything else that is not a ref is not a reading.
  if (!head.startsWith('ref: ')) return SHA.test(head) ? head : null;

  const ref = head.slice('ref: '.length).trim();
  // The worktree's own store first — a per-worktree ref lives there — then the common one, where an
  // ordinary branch ref is. Both are the same directory in a main checkout.
  for (const dir of refDir === headDir ? [headDir] : [headDir, refDir]) {
    const loose = readTrimmed(path.join(dir, ref));
    if (loose !== null) return SHA.test(loose) ? loose : null;
  }
  return packedRef(refDir, ref);
}

/**
 * Every registered repo's current HEAD, keyed by repo id. Synchronous and small on purpose: it is
 * called on a timer. The registry read is shared with the journal tap rather than parsed twice —
 * one file, one set of defaults.
 */
export function readHeads(): RepoHeads {
  const heads: RepoHeads = {};
  for (const entry of readRegistry()) heads[entry.id] = readRepoHead(entry.path);
  return heads;
}
