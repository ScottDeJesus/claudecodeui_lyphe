import fs from 'node:fs';
import path from 'node:path';

import { getConnection, memoryCandidatesDb, sessionsDb } from '@/modules/database/index.js';
import type { MemoryCandidateFull, MemoryCandidateLean } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import {
  MAX_BODY_CHARS,
  MemoryRefusal,
  PROJECT_SLUG_RE,
  PROJECT_TARGETS,
  assertIntoTarget,
  kebab,
  primaryPath,
  projectsRoot,
} from './memory-assert.js';

/**
 * The memory-intake lane's verbs: what a session PROPOSES, and what a person reviews.
 *
 * WHY THIS IS NOT IN `server/modules/kanban`. A candidate has no board, no card, no lane and no
 * `board_id`; its write targets are the operator's own shelves and a project's memory directory; its
 * reader polls and has never consumed a board frame; and its wire types already live in
 * `server/shared/types.ts`. The only thing it once borrowed from the board was the sqlite file, and
 * that file belongs to `modules/database`. So this lane imports NO board module — not the id mint,
 * not a write seam, not a frame — and nothing here records an event row or rings a bell.
 *
 * THE LIFECYCLE MIRRORS THE LESSONS LANE, member for member, with the same opposite-actor split. A
 * session stages (an inert proposal — nothing reaches disk until a person says so); only a person
 * reviews, and an approval WRITES. That is why `stageMemoryCandidate` and `approveMemoryCandidate`
 * are not symmetrical: staging is ungated and takes its actor from the ingest path's own identity,
 * while an approval is a person's act, asserted to disk and recorded on the row.
 *
 * THE READ IS LEAN, THE READ-BY-ID IS FULL. A list serves the queue a person skims — name, target,
 * status, refusal — and never the body; the body arrives from the by-id read for the one candidate
 * that person opens.
 */
export const MEMORY_TARGETS = ['memory', 'topic', 'rules', 'requirements', 'claude'] as const;

/** One of the five sanctioned homes a candidate can name. Anything else is refused at the door. */
export type MemoryTarget = (typeof MEMORY_TARGETS)[number];

/** The longest a candidate's name may be — a title, and the source of a filename besides. */
const MAX_NAME_CHARS = 80;

/** The index read's own ceiling: the most candidates one listing returns. */
const MEMORY_LIST_LIMIT = 100;

/**
 * What the door hands back: the 7-key whitelist of staging fields, and NOTHING else.
 *
 * `source` is deliberately absent — a spill file can claim one, and it would be a lie; the caller
 * passes the ingest path's own identity instead. `sessionId` is carried, but it is an UNVERIFIED
 * provenance claim, used for display and forensics and gating nothing.
 */
export type MemoryCandidateInput = {
  name: string;
  body: string;
  target: MemoryTarget;
  project: string | null;
  indexLine: string | null;
  rationale: string | null;
  sessionId: string | null;
};

/**
 * One of two spellings of the same field, whichever the caller used.
 *
 * A spill file on disk carries the snake_case spellings (`index_line`, `session_id`); a TypeScript
 * caller carries the names the row and the wire use. Both are accepted for the two multi-word fields
 * and no others, so neither caller's spelling is silently DROPPED by the whitelist below — a door
 * that discarded a field it was handed would be worse than one that refused it.
 */
function field(data: Record<string, unknown>, camel: string, snake: string): unknown {
  return data[camel] ?? data[snake];
}

/** True when `candidate` names a directory under `~/.claude/projects` — the honesty half of the slug check. */
function isDirectory(candidate: string): boolean {
  return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
}

/** A candidate that is not there is a 404, and this is the one place that sentence is written. */
export function memoryNotFound(candidateId: string): AppError {
  return new AppError(`No memory candidate with id "${candidateId}".`, {
    code: 'MEMORY_CANDIDATE_NOT_FOUND',
    statusCode: 404,
  });
}

/**
 * THE validation door: one proposed memory in, the 7-key whitelist out.
 *
 * Every field is read defensively so a MISSING key refuses cleanly instead of throwing a TypeError —
 * load-bearing on the spill path, where no transport pre-check runs. The rules, in the order a reader
 * cares about them:
 *
 *   * `target` must be one of `MEMORY_TARGETS` — it is the path ALLOWLIST key, so an unknown value
 *     has no derivable home and is refused outright.
 *   * `name` is a non-empty title of at most 80 characters; for the two file-naming targets its kebab
 *     slug must be non-empty too, since an all-punctuation name cannot name a file.
 *   * `body` must be a non-empty string of at most `MAX_BODY_CHARS`. This bound applies to EVERY
 *     target, including `claude` — which carries no cap at assert time, so this is the only size
 *     fence that target gets from this lane.
 *   * `memory` and `topic` REQUIRE a `project` slug that BOTH matches the encoded-slug shape AND
 *     exists as a directory under `~/.claude/projects`. The regex is the security fence (no `/`, no
 *     `..`); the existence check is the honesty fence — this lane never mints a project tree from a
 *     typo'd slug.
 *   * `indexLine` is REQUIRED for `memory` alone: exactly one line, starting with `- `, because it is
 *     a router line in a bullet index rather than prose.
 *
 * A refusal is a `MemoryRefusal` (a 422 wherever it surfaces) and never a fault: the caller is told
 * what to change, and nothing was written.
 */
export function validateMemoryArgs(input: unknown): MemoryCandidateInput {
  const data = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;

  const target = data.target;
  if (typeof target !== 'string' || !(MEMORY_TARGETS as readonly string[]).includes(target)) {
    throw new MemoryRefusal(
      `target must be one of ${MEMORY_TARGETS.join(', ')} — got ${JSON.stringify(target)}`
    );
  }

  const rawName = data.name;
  if (typeof rawName !== 'string' || rawName.trim() === '') {
    throw new MemoryRefusal('name is required and must be a non-empty string');
  }
  const name = rawName.trim();
  if (name.length > MAX_NAME_CHARS) {
    throw new MemoryRefusal(`name must be at most ${MAX_NAME_CHARS} characters — got ${name.length}`);
  }

  const body = data.body;
  if (typeof body !== 'string' || body.trim() === '') {
    throw new MemoryRefusal('body is required and must be a non-empty string');
  }
  if (body.length > MAX_BODY_CHARS) {
    throw new MemoryRefusal(
      `body must be at most ${MAX_BODY_CHARS} characters — got ${body.length}. A memory is a note, `
        + `not a document.`
    );
  }

  let project: string | null = null;
  if (PROJECT_TARGETS.includes(target)) {
    const rawProject = data.project;
    if (typeof rawProject !== 'string' || !PROJECT_SLUG_RE.test(rawProject)) {
      throw new MemoryRefusal(
        `target "${target}" requires a project slug like '-opt-my-project' (a leading '-', `
          + `then letters, digits and hyphens) — got ${JSON.stringify(rawProject)}`
      );
    }
    if (!isDirectory(path.join(projectsRoot(), rawProject))) {
      throw new MemoryRefusal(
        `no such project: "${rawProject}" is not a directory under ${projectsRoot()}`
      );
    }
    if (kebab(name) === '') {
      throw new MemoryRefusal(
        `a memory filename is built from the ASCII letters and digits in the name, and "${name}" has `
          + `none — give this memory an English title too`
      );
    }
    project = rawProject;
  }

  let indexLine: string | null = null;
  if (target === 'memory') {
    const rawIndexLine = field(data, 'indexLine', 'index_line');
    if (typeof rawIndexLine !== 'string' || rawIndexLine.trim() === '') {
      throw new MemoryRefusal(
        `target 'memory' requires an index_line — the one '- …' router line that points MEMORY.md at `
          + `the new note`
      );
    }
    indexLine = rawIndexLine.trim();
    if (indexLine.includes('\n')) {
      throw new MemoryRefusal('index_line must be exactly one line');
    }
    if (!indexLine.startsWith('- ')) {
      throw new MemoryRefusal("index_line must start with '- ' (it is a bullet in an index)");
    }
  }

  const rationale = data.rationale;
  const sessionId = field(data, 'sessionId', 'session_id');

  return {
    name,
    body,
    target: target as MemoryTarget,
    project,
    indexLine,
    rationale: typeof rationale === 'string' ? rationale : null,
    sessionId: typeof sessionId === 'string' ? sessionId : null,
  };
}

/**
 * A row's `sessionId` as the app session id the client can compare against the chat it has open.
 *
 * The provenance column is UNVERIFIED, and the resolver is the only translation of it — three
 * lookups that end with the id unchanged when nothing knows it. Display only: nothing in this module
 * gates on it. It drives `isMine`/`mineFirst` in the panel, so dropping it would silently un-sort the
 * operator's own proposals among everyone's.
 *
 * EVERY row leaves this module through here — list, by-id, stage, review — so no caller has to
 * remember to translate, and the list read and the by-id read of one candidate can never disagree
 * about which chat proposed it.
 */
function resolveSession(candidate: MemoryCandidateFull): MemoryCandidateFull {
  return candidate.sessionId === null
    ? candidate
    : { ...candidate, sessionId: sessionsDb.resolveAppSessionId(candidate.sessionId) };
}

/**
 * Stage one proposed memory at status `pending`, and return it as stored.
 *
 * `source` is the INGEST PATH's own identity and never the file's claim, so it is a parameter the
 * caller passes rather than a field the door would hand back.
 *
 * No event row, no frame, no bell — this lane is not a board lane. Its own `created_at` is its
 * record.
 */
export function stageMemoryCandidate(input: MemoryCandidateInput, source = 'spill'): MemoryCandidateFull {
  return resolveSession(
    memoryCandidatesDb.insertCandidate({
      name: input.name,
      body: input.body,
      target: input.target,
      project: input.project,
      indexLine: input.indexLine,
      rationale: input.rationale,
      status: 'pending',
      source,
      sessionId: input.sessionId,
    })
  );
}

/**
 * The candidate queue as LEAN rows, newest first, optionally narrowed to one status.
 *
 * `limit` is coerced to a non-negative whole number, and a value that is not a number at all falls
 * back to the default rather than raising — no caller can turn a junk parameter into a 500. It is
 * never interpolated into SQL: the repository binds it like every other value.
 */
export function listMemoryCandidates(query: { status?: string; limit?: number }): MemoryCandidateLean[] {
  const limit = typeof query.limit === 'number' && Number.isFinite(query.limit)
    ? Math.max(0, Math.trunc(query.limit))
    : MEMORY_LIST_LIMIT;

  return memoryCandidatesDb
    .listCandidates({ status: query.status, limit })
    .map((lean) => (lean.sessionId === null
      ? lean
      : { ...lean, sessionId: sessionsDb.resolveAppSessionId(lean.sessionId) }));
}

/** One candidate in the FULL projection, body and all. Null when no row carries that id. */
export function getMemoryCandidate(candidateId: string): MemoryCandidateFull | null {
  const candidate = memoryCandidatesDb.getCandidate(candidateId);
  return candidate === null ? null : resolveSession(candidate);
}

/**
 * Review or reject one PENDING candidate, in ONE transaction, with the file write LAST in it.
 *
 * The order inside the transaction is load-bearing: compare-and-set the status, stamp where the bytes
 * will land, then write. A refusal (or any fault) inside the write rolls the status, the stamp and
 * that stamp's cleared refusal back together — the candidate stays pending, exactly as if nobody had
 * clicked, which is what makes a refused approval safe to retry after a trim.
 *
 * The pre-read is the 404 miss, NOT the gate. The `AND status = 'pending'` on the statement is what
 * makes exactly one racer win: a second caller matches no row and is told the state the row is
 * actually in.
 */
function review(candidateId: string, approve: boolean): MemoryCandidateFull | null {
  if (memoryCandidatesDb.getCandidate(candidateId) === null) return null;

  const commit = getConnection().transaction((): MemoryCandidateFull => {
    const flipped = memoryCandidatesDb.reviewCandidate({
      id: candidateId,
      status: approve ? 'approved' : 'rejected',
    });
    if (flipped === null) {
      const current = memoryCandidatesDb.getCandidate(candidateId);
      throw new AppError(
        `can only review a 'pending' memory; ${candidateId} is '${current?.status ?? 'gone'}'`,
        { code: 'MEMORY_CANDIDATE_NOT_PENDING', statusCode: 422 }
      );
    }

    if (approve) {
      // Derived identically to the write below, so the stamp can never name a different file than the
      // bytes land in. It is stamped BEFORE the write, per the mandated order — and rolls back with
      // everything else if the write refuses.
      memoryCandidatesDb.markCandidateAsserted({
        id: candidateId,
        assertedPath: primaryPath(flipped.target, flipped.project, flipped.name),
      });
      // LAST inside the transaction: a refusal here rolls the status, the stamp and the cleared
      // refusal back, so nothing half-happened.
      assertIntoTarget(flipped);
    }

    const stored = memoryCandidatesDb.getCandidate(candidateId);
    if (stored === null) throw memoryNotFound(candidateId);
    return stored;
  });

  return resolveSession(commit());
}

/**
 * Approve a candidate, RECORDING a guard's refusal on the row before re-raising it.
 *
 * The recording is what makes a refusal a durable fact rather than one tab's error toast: the
 * candidate stays pending, its `refusal` column carries the words, and the queue shows them to
 * whoever looks next. It runs in its OWN statement because the transaction that produced these words
 * has already rolled back.
 *
 * Only `MemoryRefusal` is caught — never the plain `AppError` a not-currently-pending candidate
 * raises, which must NOT be annotated: that candidate is not pending, so there is nothing to annotate
 * and the row would be made to describe an obstacle that no longer exists.
 */
export function approveMemoryCandidate(candidateId: string): MemoryCandidateFull | null {
  try {
    return review(candidateId, true);
  } catch (error) {
    if (error instanceof MemoryRefusal) {
      memoryCandidatesDb.recordRefusal({ id: candidateId, refusal: error.message });
    }
    throw error;
  }
}

/** Discard one PENDING candidate. Nothing is written to any target, and a refusal cannot occur. */
export function rejectMemoryCandidate(candidateId: string): MemoryCandidateFull | null {
  return review(candidateId, false);
}

/** The lane's verbs as one bag, which is what the route package takes. */
export type MemoryIntakeService = {
  list(query: { status?: string; limit?: number }): MemoryCandidateLean[];
  get(candidateId: string): MemoryCandidateFull | null;
  approve(candidateId: string): MemoryCandidateFull | null;
  reject(candidateId: string): MemoryCandidateFull | null;
};

/** The one instance this module serves: `memory-intake.module.ts` hands it to the routes. */
export const memoryIntakeService: MemoryIntakeService = {
  list: listMemoryCandidates,
  get: getMemoryCandidate,
  approve: approveMemoryCandidate,
  reject: rejectMemoryCandidate,
};

export { MemoryRefusal };
