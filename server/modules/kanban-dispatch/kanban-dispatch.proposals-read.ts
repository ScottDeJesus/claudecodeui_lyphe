/**
 * The Bugs proposals, `dispatcher bug proposals --json`, are printed by another program, so they are read once
 * here, field by field, into the types the screen draws. A body this build cannot read is refused by name: the
 * refusal is one sentence naming the field, and the route answers it as a 502. No field is coerced to a default.
 */

import { each, field, isRecord, isText, isTextOrNull, isWholeFrom, need, oneOf } from '@/shared/document-fields.js';
import { KANBAN_PRIORITIES } from '@/shared/kanban-types.js';
import { BUG_PROPOSAL_KINDS, BUG_PROPOSAL_STATES } from '@/shared/hunt-types.js';
import type { BugProposalFinding, BugProposalRecord, BugProposalStopgap } from '@/shared/hunt-types.js';

const isId = isWholeFrom(1);

export function readProposals(body: unknown, document: string): BugProposalRecord[] {
  const top = need(body, isRecord, 'body', document);
  let index = 0;
  return each(
    field(top, 'proposals'),
    'proposals',
    (entry) => readProposal(entry, `proposals[${index++}]`, document),
    document,
  );
}

// A nullable key may be left out of the document as well as set to null; both read as null.

function readProposal(raw: unknown, at: string, document: string): BugProposalRecord {
  const row = need(raw, isRecord, at, document);
  const feature = field(row, 'feature') ?? null;
  const sentBack = field(row, 'sent_back') ?? null;
  let findingIndex = 0;
  let stopgapIndex = 0;
  return {
    id: need(field(row, 'id'), isId, `${at}.id`, document),
    path: need(field(row, 'path'), isText, `${at}.path`, document),
    title: need(field(row, 'title'), isText, `${at}.title`, document),
    words: need(field(row, 'words'), isText, `${at}.words`, document),
    kind: oneOf(field(row, 'kind'), BUG_PROPOSAL_KINDS, `${at}.kind`, document),
    priority: oneOf(field(row, 'priority'), KANBAN_PRIORITIES, `${at}.priority`, document),
    state: oneOf(field(row, 'state'), BUG_PROPOSAL_STATES, `${at}.state`, document),
    hunt: need(field(row, 'hunt') ?? null, isTextOrNull, `${at}.hunt`, document),
    source: need(field(row, 'source'), isText, `${at}.source`, document),
    proposed_at: need(field(row, 'proposed_at'), isText, `${at}.proposed_at`, document),
    ended_at: need(field(row, 'ended_at') ?? null, isTextOrNull, `${at}.ended_at`, document),
    feature: feature === null ? null : readFeature(feature, `${at}.feature`, document),
    reason: need(field(row, 'reason') ?? null, isTextOrNull, `${at}.reason`, document),
    findings: each(
      field(row, 'findings'),
      `${at}.findings`,
      (entry) => readFinding(entry, `${at}.findings[${findingIndex++}]`, document),
      document,
    ),
    stopgaps: each(
      field(row, 'stopgaps'),
      `${at}.stopgaps`,
      (entry) => readStopgap(entry, `${at}.stopgaps[${stopgapIndex++}]`, document),
      document,
    ),
    sent_back: sentBack === null ? null : readSentBack(sentBack, `${at}.sent_back`, document),
  };
}

function readFeature(raw: unknown, at: string, document: string): NonNullable<BugProposalRecord['feature']> {
  const row = need(raw, isRecord, at, document);
  return {
    name: need(field(row, 'name'), isText, `${at}.name`, document),
    title: need(field(row, 'title') ?? null, isTextOrNull, `${at}.title`, document),
    state: need(field(row, 'state') ?? null, isTextOrNull, `${at}.state`, document),
  };
}

function readFinding(raw: unknown, at: string, document: string): BugProposalFinding {
  const row = need(raw, isRecord, at, document);
  return {
    unit: need(field(row, 'unit') ?? null, isTextOrNull, `${at}.unit`, document),
    words: need(field(row, 'words'), isText, `${at}.words`, document),
    found_at: need(field(row, 'found_at'), isText, `${at}.found_at`, document),
  };
}

function readStopgap(raw: unknown, at: string, document: string): BugProposalStopgap {
  const row = need(raw, isRecord, at, document);
  return {
    ticket: need(field(row, 'ticket'), isId, `${at}.ticket`, document),
    title: need(field(row, 'title'), isText, `${at}.title`, document),
    state: need(field(row, 'state'), isText, `${at}.state`, document),
    board: need(field(row, 'board') ?? null, isTextOrNull, `${at}.board`, document),
    card: need(field(row, 'card') ?? null, isTextOrNull, `${at}.card`, document),
  };
}

function readSentBack(raw: unknown, at: string, document: string): NonNullable<BugProposalRecord['sent_back']> {
  const row = need(raw, isRecord, at, document);
  return {
    ticket: need(field(row, 'ticket'), isId, `${at}.ticket`, document),
    board: need(field(row, 'board') ?? null, isTextOrNull, `${at}.board`, document),
    card: need(field(row, 'card') ?? null, isTextOrNull, `${at}.card`, document),
  };
}
