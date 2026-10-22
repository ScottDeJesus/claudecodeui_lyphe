import os from 'node:os';
import path from 'node:path';

import { MEMORY_CAPS, type Caps } from './memory-caps.js';
// The allowlist has ONE home — `memory.service.ts`, beside the door that validates against it. This
// module reads it and never re-declares it: a second copy is a copy that can drift, and the drift
// would be a target the door accepted and the writer has no branch for.
import { MEMORY_TARGETS } from './memory.service.js';

/**
 * The memory-intake WRITE PLAN — where an approved candidate's bytes go, with no disk touched.
 *
 * THE PATH IS DERIVED, NEVER CARRIED. A candidate row names a `target` (one of the five allowlist
 * keys), a `project` slug for the project-scoped targets, and a readable `name`. It NEVER names a
 * path. Every real path is composed here from the allowlist, the home directory, a project slug
 * re-checked against `PROJECT_SLUG_RE` and a kebab-slugged name, so no column of a row — and
 * therefore no session that dropped a spill file — can aim a write outside the sanctioned homes.
 *
 * Split out of `memory-assert.ts` (the lane's disk half) so the derivation reads as one piece; the
 * lane's overview, and the targets' meanings, stay in that file's header.
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
 *
 * Consumers: `memory-compose.ts` and `memory-assert.ts` throw it; `memory.service.ts` and
 * `memory.routes.ts` catch it (through the `memory-assert.ts` re-export).
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

/**
 * One file's worth of work: where, what shape of insert, and what it must satisfy.
 *
 * Consumers: `memory-compose.ts` reads `kind`, `payload`, `anchor`, `title` and `display`; `memory-assert.ts`
 * reads the rest to guard and write each step.
 */
export type Step = {
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
  /** `section` only: the title line a shelf minted from a blank file starts with, so it passes the session-start shape check (`hooks/shelf_health.py::SHAPES`, the same words). */
  title?: string;
  /** True for the three always-loaded shelves: the writer leaves the file read-only (mode 0444), so a stray script's redirect fails instead of overwriting it. */
  readOnly?: boolean;
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
 * A column describes itself in prose and an enforced allowlist is narrower than that prose, so a row
 * can arrive here carrying a value outside it — falling through would append that row's
 * body to the global CLAUDE.md, which is the highest-blast file this lane can touch. An unknown
 * target has no derivable home, and saying so is the only honest answer.
 *
 * Consumers: `assertIntoTarget` (the write) and `primaryPath` (the stamp), both in this lane.
 */
export function stepsFor(
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
    // The door checks this slug, but a candidate can reach here without ever passing it: an
    // import inserts rows wholesale, and a hand-edited row is one `INSERT`
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
      title: '# RULES.md',
      readOnly: true,
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
      title: '# REQUIREMENTS.md',
      readOnly: true,
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
    readOnly: true,
  }];
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
