import type {
  MemoryCandidateFull,
  MemoryCandidateLean,
  MemoryCandidateRead,
  MemoryPending,
} from '@/shared/types.js';
import { readObjectRecord } from '@/shared/utils.js';

import { readStringOrNull, type DescentTransport } from './descent.transport.js';

/**
 * The memory-intake lane of the Descent proxy: the pending queue, one candidate
 * read whole, and the two review writes.
 *
 * Three rules govern everything here.
 *
 * A READ IS WHOLE OR IT IS NONE. One row missing a string `id`, `name` or
 * `target` fails the ENTIRE `pending()` read as `bad-response` — never a list
 * with the bad row quietly dropped. A shortened queue reads as "nothing left to
 * review", and the operator can act on "Descent is not reachable" while they can
 * do nothing at all about a proposal that was never drawn. This is the accounts
 * lane's own precedent, where a slot with no slug fails the whole picture.
 *
 * A 422 IS A VERDICT, NOT A FAILURE. When the cap guard refuses an approve, that
 * status and its plain-English text are the most useful thing the reviewer can be
 * told — it names what to trim — and the card stays PENDING with the same text
 * recorded on its `refusal`. So the writes here hand Descent's answer back
 * untouched and map nothing; only a Descent that gave NO verdict throws.
 *
 * This file never imports the accounts lane. That lane is a sibling, not a
 * dependency: the shared wire and its three failure words come from the
 * transport, and the plain-object narrower from the shared module.
 */

/**
 * One row of Descent's memory list → the camelCased LEAN contract, or `null`
 * when it is not a usable row (the caller fails the whole read).
 *
 * `id`, `name` and `target` are required: the id is the only handle a review
 * has, and a card with no name or no destination cannot be decided on — so a row
 * missing any of them is unusable rather than merely incomplete. Everything else
 * is `string | null`, where `null` is "Descent has none" and never `''`.
 *
 * `status` falls back to `'pending'` whenever Descent supplies no READABLE one —
 * an absent key, a `null`, a blank and a non-string alike. Descent always sends
 * it, so this is a shape guarantee rather than a judgement about a value: on the
 * list read the fallback cannot mislead, because the query that produced the row
 * WAS `?status=pending`; on the by-id read it only papers over a field Descent
 * does not omit.
 */
function toLeanCandidate(row: unknown): MemoryCandidateLean | null {
  const record = readObjectRecord(row);
  if (!record) return null;

  const id = readStringOrNull(record.id);
  const name = readStringOrNull(record.name);
  const target = readStringOrNull(record.target);
  if (id === null || name === null || target === null) return null;

  return {
    id,
    name,
    target,
    project: readStringOrNull(record.project),
    status: readStringOrNull(record.status) ?? 'pending',
    source: readStringOrNull(record.source),
    assertedPath: readStringOrNull(record.asserted_path),
    // The cap guard's own words, recorded on a card that is STILL pending.
    refusal: readStringOrNull(record.refusal),
    createdAt: readStringOrNull(record.created_at),
    reviewedAt: readStringOrNull(record.reviewed_at),
  };
}

/**
 * One row → the FULL contract, or `null`. Everything LEAN requires, plus a
 * `body`: the proposed memory text is the entire point of reading a card whole,
 * so a full read without one is not a reading and fails rather than arriving as
 * an empty panel the operator would have to interpret.
 */
function toFullCandidate(row: unknown): MemoryCandidateFull | null {
  const lean = toLeanCandidate(row);
  const record = readObjectRecord(row);
  if (!lean || !record) return null;

  const body = readStringOrNull(record.body);
  if (body === null) return null;

  return {
    ...lean,
    body,
    indexLine: readStringOrNull(record.index_line),
    rationale: readStringOrNull(record.rationale),
    sessionId: readStringOrNull(record.session_id),
  };
}

/**
 * Descent's `{ok:true, candidates:[…]}` body → the whole list, or `null`.
 *
 * `ok` is tested rather than trusted, the same way the accounts mapper tests it:
 * Descent's error envelope carries no `candidates` key at all today, so the gate
 * is redundant against the Descent that exists — and it is exactly what stops a
 * future `{ok:false, candidates:[…]}` being served as a healthy queue.
 */
function toPendingCandidates(payload: unknown): MemoryCandidateLean[] | null {
  const envelope = readObjectRecord(payload);
  if (envelope?.ok !== true || !Array.isArray(envelope.candidates)) return null;

  const candidates: MemoryCandidateLean[] = [];
  for (const entry of envelope.candidates) {
    const candidate = toLeanCandidate(entry);
    if (candidate === null) return null;
    candidates.push(candidate);
  }

  return candidates;
}

/**
 * Builds the memory lane over an already-built transport, so both lanes speak to
 * Descent through one wire with one ceiling and one failure vocabulary.
 *
 * The reads never throw: an unreachable Descent is a fact the panel states, not
 * an error wall. The writes throw `DescentUnreachable` and only that, and only
 * when Descent gave no verdict — the route turns it into a 503 carrying one word.
 */
export function createDescentMemoryService(transport: DescentTransport) {
  return {
    /** The pending queue, or the calm one-word reason it is unknown. Never throws. */
    async pending(): Promise<MemoryPending> {
      const result = await transport.readJson('/api/memory?status=pending');
      if ('failure' in result) return { reachable: false, reason: result.failure };

      const candidates = toPendingCandidates(result.body);
      return candidates === null
        ? { reachable: false, reason: 'bad-response' }
        : { reachable: true, candidates };
    },

    /**
     * One candidate read whole. Never throws, and never 404s: an id no row
     * carries comes back as `candidate: null`, which IS the answer.
     *
     * A card already approved or rejected still reads WHOLE, its `status` saying
     * which — Descent's by-id read has no status filter, unlike the list. So a
     * null here means "no such id", never "reviewed since you last looked".
     *
     * A body that is not an envelope at all is a different fact from an envelope
     * saying `ok:false`, and is reported as such — `bad-response` for the first,
     * a calm `null` for the second, exactly as `pending()` separates them.
     */
    async candidate(id: string): Promise<MemoryCandidateRead> {
      const result = await transport.readJson(`/api/memory/${encodeURIComponent(id)}`);
      if ('failure' in result) return { reachable: false, reason: result.failure };

      const envelope = readObjectRecord(result.body);
      if (!envelope) return { reachable: false, reason: 'bad-response' };
      if (envelope.ok !== true) return { reachable: true, candidate: null };

      const candidate = toFullCandidate(envelope.candidate);
      return candidate === null
        ? { reachable: false, reason: 'bad-response' }
        : { reachable: true, candidate };
    },

    /**
     * Files the candidate into its target file. Descent's own status and body
     * come back untouched — including the 422 the cap guard raises, which leaves
     * the card pending. Throws `DescentUnreachable` when Descent cannot be asked.
     */
    approve(id: string): Promise<{ status: number; body: unknown }> {
      return transport.writeJson(`/api/memory/${encodeURIComponent(id)}/approve`, {});
    },

    /** Discards the candidate; nothing is written to any target. Same three answers. */
    reject(id: string): Promise<{ status: number; body: unknown }> {
      return transport.writeJson(`/api/memory/${encodeURIComponent(id)}/reject`, {});
    },
  };
}
