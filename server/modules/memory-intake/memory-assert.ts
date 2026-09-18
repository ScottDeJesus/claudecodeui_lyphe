import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { MemoryCandidateFull } from '@/shared/types.js';

import { MEMORY_CAPS, capRefusals, type Caps } from './memory-caps.js';
// The allowlist has ONE home — `memory.service.ts`, beside the door that validates against it. This
// module reads it and never re-declares it: a second copy is a copy that can drift, and the drift
// would be a target the door accepted and the writer has no branch for.
import { MEMORY_TARGETS } from './memory.service.js';

/**
 * The memory-intake ASSERTION engine — the DISK half of the lane.
 *
 * WHY THIS IS ITS OWN FILE: `memory.service.ts` owns the database lifecycle of a candidate (stage,
 * list, read, review). This owns the entirely separate concern of turning an APPROVED candidate into
 * bytes: path derivation, composition, the atomic write. The size budgets and their prose are a third
 * concern and live in `memory-caps.ts`.
 *
 * THE PATH IS DERIVED, NEVER CARRIED. A candidate row names a `target` (one of the five allowlist
 * keys), a `project` slug for the project-scoped targets, and a readable `name`. It NEVER names a
 * path. Every real path is composed here from the allowlist, the home directory, a project slug
 * re-checked against `PROJECT_SLUG_RE` and a kebab-slugged name, so no column of a row — and
 * therefore no session that dropped a spill file, and no row Phase 6's import copies in from
 * Descent's own table — can aim a write outside the sanctioned homes:
 *
 *   * `memory`       → `~/.claude/projects/<project>/memory/<kebab>.md` (a NEW topic note), and THEN
 *                      one `- …` router line appended to that project's `memory/MEMORY.md`
 *   * `topic`        → the new topic note ONLY (no router line — a note nothing points at yet)
 *   * `rules`        → the body inserted at the END of `## Rules` in `~/.claude/RULES.md`
 *   * `requirements` → the body inserted at the END of `## Requirements` in `~/.claude/REQUIREMENTS.md`
 *   * `claude`       → the body appended to `~/.claude/CLAUDE.md` (the high-blast one)
 *
 * A TOPIC NOTE IS ALWAYS A NEW FILE — a name collision REFUSES. `kebab` collapses every
 * non-alphanumeric run to one hyphen and lowercases, so `My Note`, `my note!` and `my.note` all name
 * the same file: two sessions proposing memories on one subject collide BY CONSTRUCTION, which is
 * exactly when it matters. Refusing keeps two unrelated memories from silently becoming one blob,
 * and keeps a `memory` candidate from minting a second router line pointing at it. Merging into an
 * existing note stays possible — but as somebody's DECISION, never as an accident of naming. (An
 * id-prefixed filename, which the lessons lane uses for its staging directory, is wrong here: this is
 * the operator's permanent hand-read corpus, and the `memory` target's own `index_line` names the
 * file by its readable name — renaming under it would mint the dangling pointer the ordering below
 * exists to prevent.)
 *
 * TOPIC NOTE FIRST, ROUTER LINE SECOND — deliberately. If the second write faults, the residue is an
 * ORPHAN NOTE, which is harmless: nothing points at it. The reverse order would leave a DANGLING
 * INDEX POINTER, a router line naming a file that does not exist, which every future orient read
 * chases.
 *
 * EVERY GUARD RUNS BEFORE ANY BYTE IS WRITTEN. `assertIntoTarget` runs in two passes — read, compose
 * and guard every step, THEN write every step — so a budget breach on the second file leaves the
 * first untouched, and only a genuine mid-write disk fault can leave a partial result.
 */

/**
 * An assertion GUARD refused to write: a size budget, a name collision, a missing required file or
 * section, or a name that cannot become a filename.
 *
 * The SUBCLASS is what lets `approveMemoryCandidate` catch a REFUSAL specifically — recording its
 * words on the row — without also swallowing the plain `AppError` a not-currently-pending candidate
 * raises, which must NOT be recorded: that candidate is not pending, there is nothing to annotate,
 * and its refusal column would be describing an attempt nobody made.
 *
 * A raw filesystem fault is deliberately NOT wrapped in this: an unwritable disk is infrastructure,
 * not a domain refusal, and it must surface as a retryable 500 rather than as a durable "this memory
 * was refused" annotation on a candidate that is perfectly fine.
 */
export class MemoryRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryRefusal';
  }
}

/**
 * The two project-scoped targets: the ones that name a `~/.claude/projects/<slug>` directory.
 *
 * They require a resolved `project`, because their paths are composed under it — everywhere else a
 * `project` on a row is provenance and never a destination.
 */
export const PROJECT_TARGETS: readonly string[] = ['memory', 'topic'];

/**
 * A project slug as Claude Code encodes it: a leading `-`, then path segments joined by `-`
 * (`/opt/my-project` → `-opt-my-project`).
 *
 * The anchored character class is the SECURITY shape — no `/`, no `.`, no `..` — so a slug can never
 * climb out of `projects/`. In JavaScript, `$` without the `m` flag matches only at the very end of
 * the string (unlike Python's `$`, which also matches before a trailing newline), so this anchor is
 * the `\Z` the ported regex was written with.
 */
export const PROJECT_SLUG_RE = /^-[A-Za-z0-9-]+$/;

/**
 * The whole-body bound, applied at STAGING to every target by the door next door.
 *
 * It lives here so the door and this module name one number. A memory is a note, not a document;
 * 4,000 characters is already generous for one, and it is the ONLY size fence the `claude` target
 * gets from this lane.
 */
export const MAX_BODY_CHARS = 4000;

/** One file's worth of work: where, what shape of insert, and what it must satisfy. */
type Step = {
  path: string;
  /** `create` mints a new note, `line` joins a router line to a list, `append` ends a document, `section` lands under a heading. */
  kind: 'create' | 'line' | 'append' | 'section';
  payload: string;
  /** The budget for the file this step writes, or null when it carries none. */
  caps: Caps | null;
  /** True when an absent file REFUSES this step — this lane never mints CLAUDE.md or a shelf. */
  mustExist: boolean;
  /** What the person is told this FILE is, in the words of a refusal. */
  display: string;
  /** `section` only: the heading the payload lands under. */
  anchor?: string;
};

/**
 * A filesystem-safe slug of `name` — the load-bearing SECURITY shape of every topic note's path.
 *
 * Every run of characters outside `[a-z0-9]` collapses to one hyphen and the ends are stripped, so no
 * `/`, `..`, NUL or other path metacharacter survives from a caller's name into a filename. Bounded
 * to sixty characters so a pathological name cannot mint an absurd one.
 *
 * ASCII-only by design, so a name written entirely in non-Latin script returns `''` — the caller must
 * read an empty slug as "this name cannot become a filename" and say so honestly, which both the door
 * and the belt below do. Telling a person that a name made of letters "has no letters" is a lie to
 * their face, so the refusal names the real constraint and the real remedy instead.
 */
export function kebab(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/** `~/.claude/projects` — the parent every project-scoped path is composed under. */
export function projectsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/** `~/.claude/projects/<project>/memory` — where a project's memory files live. */
export function projectMemoryDir(project: string): string {
  return path.join(projectsRoot(), project, 'memory');
}

/**
 * The ordered write plan for one approved candidate. Paths DERIVED here, never carried.
 *
 * The order is load-bearing for `memory`: the topic note first, its router line second.
 *
 * A target that is not one of the five REFUSES rather than falling through to the last branch.
 * Descent's own DDL comment names a fourth `target` value (`user`) that its enforced allowlist never
 * had, and a row carrying one can reach here from an import — falling through would append that row's
 * body to the global CLAUDE.md, which is the highest-blast file this lane can touch. An unknown
 * target has no derivable home, and saying so is the only honest answer.
 */
function stepsFor(
  target: string,
  project: string | null,
  name: string,
  body: string,
  indexLine: string | null
): Step[] {
  if (!(MEMORY_TARGETS as readonly string[]).includes(target)) {
    throw new MemoryRefusal(
      `Refused — “${target}” is not one of this lane's targets (${MEMORY_TARGETS.join(', ')}), so `
        + `there is nowhere to write this memory. Nothing was changed.`
    );
  }

  if (PROJECT_TARGETS.includes(target)) {
    // The SECURITY belt behind the door, and the one no import can walk around.
    //
    // The door checks this slug, but a candidate can reach here without ever passing it: Phase 6's
    // import inserts rows wholesale from Descent's own table, and a hand-edited row is one `INSERT`
    // away in any case. So the slug is re-checked at the only place in the module that composes a
    // path. `String(project)` would happily turn a `null` into a directory named "null" and a
    // `../../etc` into a climb out of `projects/` — the exact escape this file's header says no
    // column of a row can aim. Nothing but an encoded slug may name a directory here.
    if (project === null || !PROJECT_SLUG_RE.test(project)) {
      throw new MemoryRefusal(
        `Refused — target “${target}” writes into a project's memory directory, so it needs a project `
          + `slug like “-opt-my-project” (a leading “-”, then letters, digits and hyphens). This `
          + `candidate carries ${JSON.stringify(project)}, which names no such directory, so there is `
          + `nowhere safe to write it. Nothing was changed.`
      );
    }
    const slug = kebab(name);
    if (slug === '') {
      // The belt behind the door's friendlier refusal. Without it the note's path would be
      // `…/memory/.md` — a hidden file nobody would ever find again.
      throw new MemoryRefusal(
        `Refused — a memory filename is built from the ASCII letters and digits in the name, and `
          + `“${name}” has none. Give this memory an English title too, then approve again. Nothing `
          + `was changed.`
      );
    }
    const note: Step = {
      path: path.join(projectMemoryDir(project), `${slug}.md`),
      kind: 'create',
      payload: body,
      caps: MEMORY_CAPS.topicNote,
      mustExist: false,
      display: `the ${project} memory note ${slug}.md`,
    };
    if (target === 'topic') return [note];
    return [
      note,
      {
        path: path.join(projectMemoryDir(project), 'MEMORY.md'),
        kind: 'line',
        payload: (indexLine ?? '').trim(),
        caps: MEMORY_CAPS.memoryMd,
        mustExist: true,
        display: `the ${project} memory index MEMORY.md`,
      },
    ];
  }

  if (target === 'rules') {
    return [{
      path: path.join(os.homedir(), '.claude', 'RULES.md'),
      kind: 'section',
      payload: body,
      caps: MEMORY_CAPS.rulesMd,
      mustExist: true,
      display: 'your RULES.md shelf',
      anchor: '## Rules',
    }];
  }

  if (target === 'requirements') {
    return [{
      path: path.join(os.homedir(), '.claude', 'REQUIREMENTS.md'),
      kind: 'section',
      payload: body,
      caps: MEMORY_CAPS.requirementsMd,
      mustExist: true,
      display: 'your REQUIREMENTS.md shelf',
      anchor: '## Requirements',
    }];
  }

  // `claude` — the only remaining allowlist key, and the only target with no heading to land under.
  return [{
    path: path.join(os.homedir(), '.claude', 'CLAUDE.md'),
    kind: 'append',
    payload: body,
    caps: MEMORY_CAPS.claudeMd,
    mustExist: true,
    display: 'the global CLAUDE.md',
  }];
}

/**
 * The new whole-file content for one step, from the bytes the file holds now. Pure — no disk, and
 * MemoryRefusal is the only thing it throws.
 */
function compose(step: Step, current: string): string {
  const payload = step.payload.replace(/^\n+|\n+$/g, '');

  if (step.kind === 'create') {
    // Reached only when the path did NOT exist (the caller refuses otherwise), so there is nothing to
    // merge with: the note IS the body.
    return `${payload}\n`;
  }

  if (step.kind === 'line') {
    // A router line joins the file's last line DIRECTLY, with no blank-line gap, so it lands INSIDE a
    // trailing bullet list rather than orphaned below it.
    if (current.trim() === '') return `${payload}\n`;
    return `${current.replace(/\n+$/, '')}\n${payload}\n`;
  }

  if (step.kind === 'append') {
    if (current.trim() === '') return `${payload}\n`;
    return `${current.replace(/\n+$/, '')}\n\n${payload}\n`;
  }

  // 'section': land the payload at the END of the named heading's section — after whatever is already
  // there, before the NEXT '## ' heading, or at the end of the file when it is the last section.
  const lines = current.split('\n');
  const start = lines.findIndex((line) => line.trim() === step.anchor);
  if (start === -1) {
    throw new MemoryRefusal(
      `Refused — ${step.display} has no “${step.anchor}” section to add this under, and this lane `
        + `will not invent one. Add that heading yourself, then approve again. Nothing was changed.`
    );
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  const head = lines.slice(0, end).join('\n').replace(/\n+$/, '');
  const tail = lines.slice(end).join('\n');
  const inserted = `${head}\n\n${payload}\n`;
  return tail.trim() === '' ? inserted : `${inserted}\n${tail}`;
}

/**
 * Replace `path` with `content` in one step. A filesystem fault here is NOT a refusal and is left
 * to surface as it is — an unwritable disk is infrastructure, and the operator retries.
 *
 * The temp file is written in the SAME directory, so the rename that follows is a same-filesystem
 * rename and therefore atomic: a reader never observes a half-written memory file, and a crash
 * mid-write leaves either the old bytes or the new ones, never a hybrid of both.
 */
function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.memory-tmp-${process.pid}`);
  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
  } finally {
    try {
      fs.unlinkSync(tempPath); // a no-op once the rename has consumed it
    } catch {
      // Nothing to do: the rename already moved it, and a leftover temp file is not a write fault.
    }
  }
}

/**
 * Write one approved candidate into its derived home(s), returning the PRIMARY file's path — the file
 * the BODY landed in, which for a `memory` candidate is the note and not the index it also touched.
 *
 * Two passes, deliberately: read, compose and GUARD every step first, so a refusal on the second file
 * leaves the first untouched; then write every step in order. Throws `MemoryRefusal` for a budget
 * breach, a name collision, a missing required file or section, or a name that cannot become a
 * filename — and lets a filesystem fault through untouched.
 *
 * Called INSIDE the approve transaction and LAST within it, so a refusal rolls the whole review back
 * before a single byte is written.
 *
 * ⚠ NOT IDEMPOTENT, and the ordering is all-or-nothing in one direction only. A refusal or a disk
 * fault here rolls back the row, its stamps and its refusal column — nothing half-happened. But if
 * the write SUCCEEDS and the surrounding transaction then fails to commit, the bytes are on disk
 * while the candidate stays pending, and a re-approve writes them again. A visible duplicate beats a
 * silent loss.
 */
export function assertIntoTarget(row: MemoryCandidateFull): { path: string } {
  const planned: Array<{ step: Step; next: string }> = [];

  for (const step of stepsFor(row.target, row.project, row.name, row.body, row.indexLine)) {
    const exists = fs.existsSync(step.path);
    if (step.mustExist && !exists) {
      throw new MemoryRefusal(
        `Refused — ${step.display} does not exist (${step.path}), and this lane only ADDS to files `
          + `that are already there; it never creates one. Nothing was changed.`
      );
    }
    if (step.kind === 'create' && exists) {
      throw new MemoryRefusal(
        `Refused — ${step.display} already exists, and this lane never writes over or merges into a `
          + `note that is already there. Give this memory a different name and approve again — or add `
          + `it to that note yourself. Nothing was changed.`
      );
    }
    const current = exists ? fs.readFileSync(step.path, 'utf8') : '';
    const next = compose(step, current);
    const reasons = capRefusals(step.caps, step.display, next, current);
    if (reasons.length > 0) {
      throw new MemoryRefusal(`Refused — ${reasons.join(' ')} Nothing was changed.`);
    }
    planned.push({ step, next });
  }

  for (const { step, next } of planned) {
    atomicWrite(step.path, next);
  }

  // Unreachable as things stand: every allowlisted target plans at least one step, and a target this
  // lane does not know refuses in `stepsFor`. Kept so a target added later without a step is a loud
  // refusal rather than a candidate stamped with a path nothing wrote.
  if (planned.length === 0) {
    throw new MemoryRefusal(
      `Refused — target “${row.target}” planned no file to write. Nothing was changed.`
    );
  }
  return { path: planned[0].step.path };
}

/**
 * The path a candidate's body WOULD land in — derived, with no disk touched and nothing written.
 *
 * Used to stamp `asserted_path` inside the review transaction before the write happens. It shares
 * `stepsFor` with `assertIntoTarget`, so the stamp and the bytes can never name different files.
 *
 * Raises `MemoryRefusal` for a name that cannot become a filename — the same belt, through the same
 * derivation.
 */
export function primaryPath(target: string, project: string | null, name: string): string {
  const first = stepsFor(target, project, name, '', null)[0];
  return first.path;
}
