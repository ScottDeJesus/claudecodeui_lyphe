import fs from 'node:fs';
import path from 'node:path';

import type { MemoryCandidateFull } from '@/shared/types.js';

import { capRefusals } from './memory-caps.js';
import { compose } from './memory-compose.js';
import { MemoryRefusal, stepsFor, type Step } from './memory-plan.js';

// The public surface of the lane's write half, unchanged since the plan (`memory-plan.ts`) and the
// composer (`memory-compose.ts`) moved out: `memory.service.ts` and `memory.routes.ts` still import
// every one of these from here, and the barrel re-exports `MemoryRefusal` and `assertIntoTarget`.
export {
  MAX_BODY_CHARS,
  MemoryRefusal,
  PROJECT_SLUG_RE,
  PROJECT_TARGETS,
  kebab,
  primaryPath,
  projectMemoryDir,
  projectsRoot,
} from './memory-plan.js';

/**
 * The memory-intake ASSERTION engine — the DISK half of the lane.
 *
 * WHY THIS IS ITS OWN FILE: `memory.service.ts` owns the database lifecycle of a candidate (stage,
 * list, read, review). This owns the entirely separate concern of turning an APPROVED candidate into
 * bytes, and is the lane's front door for it: the guards and the atomic write live here, the path
 * derivation in `memory-plan.ts`, the whole-file composition in `memory-compose.ts`. The size
 * budgets and their prose are a further concern and live in `memory-caps.ts`.
 *
 * THE PATH IS DERIVED, NEVER CARRIED. A candidate row names a `target` (one of the five allowlist
 * keys), a `project` slug for the project-scoped targets, and a readable `name`. It NEVER names a
 * path. Every real path is composed in `memory-plan.ts` from the allowlist, the home directory, a
 * project slug re-checked against `PROJECT_SLUG_RE` and a kebab-slugged name, so no column of a row —
 * and therefore no session that dropped a spill file — can aim a write outside the sanctioned homes:
 *
 *   * `memory`       → `~/.claude/projects/<project>/memory/<kebab>.md` (a NEW topic note), and THEN
 *                      one `- …` router line appended to that project's `memory/MEMORY.md`
 *   * `topic`        → the new topic note ONLY (no router line — a note nothing points at yet)
 *   * `rules`        → the body inserted at the END of `## Rules` in `~/.claude/RULES.md`; into a BLANK
 *                      file, a body carrying `## Rules` becomes the whole file (a restore) and any other
 *                      body becomes the first entry under a `# RULES.md` title and `## Rules` heading
 *                      written here, while a file that already has content refuses a body carrying the
 *                      heading
 *   * `requirements` → the body inserted at the END of `## Requirements` in `~/.claude/REQUIREMENTS.md`;
 *                      a BLANK file is refilled the same way, under a `# REQUIREMENTS.md` title and
 *                      `## Requirements` heading
 *   * `claude`       → the body appended to `~/.claude/CLAUDE.md` (the high-blast one)
 *
 * THE THREE SHELVES LAND READ-ONLY (mode 0444, `SHELF_FILE_MODE`): this door replaces them by rename,
 * which a read-only file does not stop, while every stray shell redirect, `cp` or `open(…, 'w')`
 * does — a script that meant to write somewhere else fails loudly instead of overwriting the
 * operator's rules.
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
 * The mode of the three always-loaded shelves (RULES.md, REQUIREMENTS.md, CLAUDE.md): read-only for
 * everyone. The python side keeps the same number — `hooks/shelf_health.py::SHELF_MODE` re-applies it
 * at every main session start — so a file a git checkout recreated at 0644 is locked again.
 * Memory notes and the MEMORY.md index are NOT shelves and keep the mode a plain write gives them.
 */
const SHELF_FILE_MODE = 0o444;

/**
 * Replace `path` with `content` in one step. A filesystem fault here is NOT a refusal and is left
 * to surface as it is — an unwritable disk is infrastructure, and the operator retries.
 *
 * The temp file is written in the SAME directory, so the rename that follows is a same-filesystem
 * rename and therefore atomic: a reader never observes a half-written memory file, and a crash
 * mid-write leaves either the old bytes or the new ones, never a hybrid of both.
 *
 * `readOnly` sets the temp file to `SHELF_FILE_MODE` BEFORE the rename, so the shelf never exists
 * writable at its real path. This is the lock's whole point: a stray `> RULES.md` fails with
 * "Permission denied" instead of silently overwriting the file (a review's test script did exactly
 * that on 2026-10-10). The rename itself needs only the DIRECTORY's write bit, so this door — the
 * one sanctioned writer — passes straight over the 0444 file it replaces.
 */
function atomicWrite(filePath: string, content: string, readOnly: boolean): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.memory-tmp-${process.pid}`);
  try {
    // A temp file an earlier crash left read-only (same pid, reused) would refuse this open.
    fs.rmSync(tempPath, { force: true });
    fs.writeFileSync(tempPath, content, 'utf8');
    if (readOnly) fs.chmodSync(tempPath, SHELF_FILE_MODE);
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
    // A blank file is measured as the empty file `compose` treats it as: the ratchet compares `next`
    // against `current`, and blank space would otherwise hide an over-budget write behind its own size.
    const reasons = capRefusals(step.caps, step.display, next, current.trim() === '' ? '' : current);
    if (reasons.length > 0) {
      throw new MemoryRefusal(`Refused — ${reasons.join(' ')} Nothing was changed.`);
    }
    planned.push({ step, next });
  }

  for (const { step, next } of planned) {
    atomicWrite(step.path, next, step.readOnly === true);
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
