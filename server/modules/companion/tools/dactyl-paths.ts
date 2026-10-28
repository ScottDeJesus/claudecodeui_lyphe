import { realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { listVisibleProjects } from './house-reads.js';
import { companionScratchDir } from './transcript-render.js';

/**
 * Which files a dactyl may be sent: the rules `ask_dactyl` holds every path to BEFORE any dactyl starts.
 *
 * WHY THEY EXIST. A dactyl's answer lands in her context and may be spoken aloud, so a file that holds a secret must
 * never reach one: whatever a dactyl reads, it can say. The rules therefore run on the file the path RESOLVES to
 * (`realpath`), not only on the name she typed — a link called `notes.txt` that points at a `.env` is a `.env` — and
 * a name is judged whether or not the file exists, so a missing `.env` is still refused as a `.env`, not "not found".
 *
 * A FILE MUST BE a regular file whose realpath is under one of three roots: a visible project's path, `~/.claude`,
 * or her own scratch (`~/.claude/state/companion/<user id>/scratch`, where her rendered transcripts are written — it
 * is inside `~/.claude` and says so on its own). And it must not be DENIED. A file is denied when any segment of its
 * path (compared without regard to case) is or looks like a secret:
 *   - by pattern: starts with `.env`, `credentials`, `secrets` or `.claude.json`; ends in `.env`, `.pem`, `.key`,
 *     `.p12`, `.pfx`, `.db`, `.token` or `_history`; holds `.sqlite`; is an SSH key (`id_rsa`, `id_dsa`, `id_ecdsa`,
 *     `id_ed25519` with any suffix, or any `id_*` with no extension);
 *   - by name: `.git-credentials`, `.netrc`, `.npmrc`, `.pgpass`, `.pypirc`, `.htpasswd`, `hosts.yml` (the GitHub CLI's
 *     token file), and the folders `.ssh`, `.aws`, `.gnupg`, `.kube` and `.docker`;
 *   - by place: under `~/.claude/state/claude_account`, or `~/.claude/.credentials.json` itself; and anything in a home
 *     dot-folder or dotfile other than `~/.claude` (`~/.cloudcli`, `~/.codex/auth.json`, `~/.openclaw/…`, `~/.config/…`,
 *     `~/.vscode-server/…`). Applications keep their tokens and keys there under names no list can predict
 *     (`auth.json`, `agent-host-token`, `device.json`), so the cure is the place, not a longer list; no registered
 *     project lives in one, and `~/.claude` stays whole (its own `claude_account` and `.credentials.json` are denied above).
 * The roots (`/home/lyphe` and `/opt` are registered projects) can still hold a secret under an ordinary name in an
 * ordinary folder, so the name rules stay a net, not a promise. A denied path is refused BY NAME, in a sentence that
 * says why, and no dactyl starts for the call.
 *
 * A name that is not a full path (`server/shared/prompt-stream.ts`, as a person says it) is looked for under the
 * visible projects: one project holding it is the file, none or several is a sentence that says what to give.
 *
 * Consumer: `read-tools.ts` (`ask_dactyl`), on every file and on the context file.
 */

/** The file or folder names that are secrets whole, whatever sits beside them. Compared in lower case. */
const DENIED_NAMES = ['.git-credentials', '.netrc', '.npmrc', '.pgpass', '.pypirc', '.htpasswd', 'hosts.yml', 'hosts.yaml', '.ssh', '.aws', '.gnupg', '.kube', '.docker'] as const;

/** The segments a path may not pass through, and how a refusal names the rule. Compared in lower case. */
const DENIED_SEGMENTS: ReadonlyArray<{ matches: (segment: string) => boolean; rule: string }> = [
  { matches: (segment) => segment.startsWith('.env'), rule: '.env*' },
  { matches: (segment) => segment.endsWith('.env'), rule: '*.env' },
  { matches: (segment) => segment.endsWith('.pem'), rule: '*.pem' },
  { matches: (segment) => segment.endsWith('.key'), rule: '*.key' },
  { matches: (segment) => segment.endsWith('.p12') || segment.endsWith('.pfx'), rule: '*.p12 and *.pfx' },
  { matches: (segment) => segment.startsWith('id_rsa'), rule: 'id_rsa*' },
  { matches: (segment) => /^id_(dsa|ecdsa|ed25519)/.test(segment), rule: 'the SSH key names id_dsa*, id_ecdsa* and id_ed25519*' },
  { matches: (segment) => /^id_[^.]*$/.test(segment), rule: 'id_* with no extension (an SSH key)' },
  { matches: (segment) => segment.startsWith('credentials'), rule: 'credentials*' },
  { matches: (segment) => segment.startsWith('secrets'), rule: 'secrets*' },
  { matches: (segment) => segment.startsWith('.claude.json'), rule: '.claude.json*' },
  { matches: (segment) => segment.endsWith('.token'), rule: '*.token' },
  { matches: (segment) => segment.endsWith('_history'), rule: '*_history' },
  { matches: (segment) => segment.endsWith('.db'), rule: '*.db' },
  { matches: (segment) => segment.includes('.sqlite'), rule: '*.sqlite*' },
  ...DENIED_NAMES.map((name) => ({ matches: (segment: string) => segment === name, rule: name })),
];

/** The places no dactyl reads from, in the home-relative form a refusal quotes. */
const DENIED_HOME_PATHS = ['.claude/state/claude_account', '.claude/.credentials.json'] as const;

const isUnder = (child: string, root: string): boolean => child === root || child.startsWith(root + path.sep);

/** A path made absolute: `~` and `~/` mean the home folder, everything else is taken as written. */
const withHome = (given: string): string => (given === '~' ? os.homedir() : given.startsWith('~/') ? path.join(os.homedir(), given.slice(2)) : given);

/** The real path of a folder or file that may not exist: its realpath when it does, else the path itself (nothing to resolve through). */
function realOrSelf(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
}

/** The rule `candidate` (an absolute path) breaks, in words, or `null` when none. Judged on the path as written AND as resolved by the caller. */
function deniedBy(candidate: string): string | null {
  for (const segment of candidate.split(path.sep)) {
    const hit = DENIED_SEGMENTS.find((denied) => denied.matches(segment.toLowerCase()));
    if (hit) return `its name "${segment}" matches ${hit.rule}`;
  }
  for (const home of new Set([os.homedir(), realOrSelf(os.homedir())])) {
    const first = candidate.startsWith(home + path.sep) ? candidate.slice(home.length + 1).split(path.sep)[0] : '';
    if (first.startsWith('.') && first !== '.claude') return `it sits in ~/${first}, a home dot-folder where applications keep their tokens and keys`;
  }
  for (const homePath of DENIED_HOME_PATHS) {
    const root = path.join(os.homedir(), homePath);
    const real = realOrSelf(root);
    if (candidate === root || candidate === real) return `it is ~/${homePath}`;
    if (isUnder(candidate, root) || isUnder(candidate, real)) return `it sits under ~/${homePath}`;
  }
  return null;
}

/** The refusal of a denied file: names it, says why, and says no dactyl started. */
const refusedByName = (shown: string, why: string): string =>
  `Refused: ${shown} — ${why}. A dactyl's answer can be spoken aloud, so a file like this never goes to one, and no dactyl was started. Ask about another file, or tell him it is his to open.`;

/** The roots a file may sit under, as realpaths. */
function allowedRoots(userId: number): string[] {
  const roots = [...listVisibleProjects().map((project) => project.path), path.join(os.homedir(), '.claude'), companionScratchDir(userId)];
  return roots.map(realOrSelf);
}

/** A name that is not a full path, found under the visible projects: the one file it names, or the sentence that says what to give. */
function findUnderProjects(given: string): { ok: true; file: string } | { ok: false; sentence: string } {
  const found = listVisibleProjects()
    .map((project) => ({ project, file: path.join(project.path, given) }))
    .filter(({ file }) => {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    });
  if (found.length === 1) return { ok: true, file: found[0].file };
  if (found.length === 0) return { ok: false, sentence: `"${given}" is not a full path and no project holds a file of that name. Give the full path; list_projects shows where each project lives.` };
  return { ok: false, sentence: `"${given}" is in ${found.length} projects (${found.map(({ project }) => `"${project.name}"`).join(', ')}). Give the full path of the one meant.` };
}

/** One path judged: the real file it comes to, or the sentence that refuses it. Consumed by `resolveDactylFiles`. */
function judgeFile(given: string, roots: string[]): { ok: true; file: string } | { ok: false; sentence: string } {
  const written = withHome(given.trim());
  // The name alone is judged first: a `.env` that does not exist is still refused as a `.env`.
  if (path.isAbsolute(written)) {
    const byName = deniedBy(path.resolve(written));
    if (byName) return { ok: false, sentence: refusedByName(given.trim(), byName) };
  }
  const located = path.isAbsolute(written) ? { ok: true as const, file: written } : findUnderProjects(written);
  if (!located.ok) return located;

  let real: string;
  try {
    real = realpathSync(located.file);
  } catch {
    return { ok: false, sentence: `${given.trim()} does not exist, or cannot be reached. Check the path; ask_dactyl reads files that exist.` };
  }
  const byRealName = deniedBy(real);
  if (byRealName) {
    const shown = real === path.resolve(located.file) ? given.trim() : `${given.trim()} (which is ${real})`;
    return { ok: false, sentence: refusedByName(shown, byRealName) };
  }
  if (!statSync(real).isFile()) return { ok: false, sentence: `${given.trim()} is not a regular file, and a dactyl reads one file each. Name the files inside it.` };
  if (!roots.some((root) => isUnder(real, root))) {
    return { ok: false, sentence: `${given.trim()} is outside what a dactyl may read: a visible project, ~/.claude, or her own scratch folder. Pick a file inside one of them.` };
  }
  return { ok: true, file: real };
}

/** The answer of `resolveDactylFiles`: every file as its real path, in the order given and each once, or one sentence naming every file refused. Consumed by `read-tools.ts` (`ask_dactyl`), which hands the files on or refuses with the sentence. */
export type DactylFiles = { ok: true; files: string[] } | { ok: false; sentence: string };

/**
 * Holds every path in `given` (the files, then the context file if any) to the rules above. Every path is judged, so
 * the sentence names ALL the refused ones; nothing is returned for the ones that pass when any fails — the caller
 * starts no dactyl. The files answered are REAL paths, so the dactyl reads exactly what was judged, and a path given
 * twice is answered once. Consumer: `read-tools.ts` (`ask_dactyl`), which hands the answer to `runDactylRead`.
 */
export function resolveDactylFiles(userId: number, given: string[]): DactylFiles {
  const roots = allowedRoots(userId);
  const files: string[] = [];
  const sentences: string[] = [];
  for (const file of given) {
    const judged = judgeFile(file, roots);
    if (!judged.ok) sentences.push(judged.sentence);
    else if (!files.includes(judged.file)) files.push(judged.file);
  }
  return sentences.length > 0 ? { ok: false, sentence: sentences.join(' ') } : { ok: true, files };
}
