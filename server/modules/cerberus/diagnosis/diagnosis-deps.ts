import { cerberusDefinitionsDb } from '@/modules/database/index.js';
import type { CerberusDiagnosisToolDeps } from '@/shared/cerberus-types.js';

import { unquotedLines, unquotedSentence } from './diagnosis-absence.js';
import { unsupportedClauses, unsupportedSentence } from './diagnosis-audit.js';
import { historyReadStep, nodeReadStep } from './diagnosis-step-words.js';
import type { DiagnosisStepLog } from './diagnosis-steps.js';
import { readDiagnosisHistory } from './diagnosis-history.js';
import { givenFactsOf } from './diagnosis-prompt.js';
import { unreadQuotations, unreadQuotationsSentence } from './diagnosis-quotes.js';
import { carriesCredential, oneMaskedLine } from './diagnosis-text.js';
import { callNode } from './diagnosis-wire.js';

/**
 * What the agent's six tools reach for one running diagnosis (`CerberusDiagnosisToolDeps`): the seam
 * `diagnosis-tools.ts` is built against, filled here with the link, the store and the step log.
 *
 * EVERY READ LEAVES ITS STEP BEFORE IT RUNS — "Reading the journal of docstore.service · last 15
 * min" is on the sheet while the read is still going, which is the point of watching a diagnosis. The
 * line is written from what is actually sent (`diagnosis-step-words.ts`). The agent's `note` is one
 * more step, in its own words. The node reads are the warden's three and reach only the node the
 * diagnosis opened on: `callNode` is bound to `node` and `diagId` here, and the tools cannot name another.
 *
 * A READ ASKED AFTER THE END is refused here, not sent. The agent is stopped when a diagnosis ends, but a
 * tool call already in its hands can still arrive after `diag.close` has gone: it would reach a warden
 * that no longer holds the session, and be answered "No diagnosis is open on this node" for nobody.
 * `isOver` is the service's own flag; the tool turns the refusal into an answer the agent reads.
 *
 * A QUOTATION MUST HAVE BEEN READ. Every answer a read returns is kept here, before any note is added under it, and
 * `submit` refuses a summary or an evidence line — and `note` a finding — with words in quotation marks that none of those
 * answers (nor the system prompt, `told`) holds (`diagnosis-quotes.ts`): the agent hears which, and tries again with the
 * words copied exactly or the claim left out.
 *
 * THE AGENT'S OWN WORDS ARE MASKED (`diagnosis-text.ts`). Every input the agent sees is masked, but a model can reassemble or
 * invent a credential, and a step is drawn and kept for ever: a `note` goes through `oneMaskedLine` before it becomes a step,
 * and the summary and evidence of a submission are masked as `conclude` stores them. A proposed command is the exception, since
 * the masked command would not run and the unmasked one is dangerous: `submit` refuses a `cmd` or `general` the mask would
 * change, and the agent resubmits without the credential.
 *
 * EVIDENCE IS WHAT WAS FOUND. `submit` also refuses an evidence line that is not one stretch of one line of an answer of a read that
 * succeeded (`diagnosis-absence.ts`): verbatim, at least 20 characters, nothing of the agent's own on it, and never the prompt (the
 * check's value, its recent results) or a read's own empty sentence as the source. An absence has nothing to copy, and an edited,
 * spliced or decorated line is not a line of a read, so "zero sweep entries found", a paraphrase of a file and a journal line with
 * its time moved all fall to the one rule, which a share of the line or a list of words could not hold (INV-7169, measured four times).
 *
 * THE SUMMARY IS HELD LAST, BY A SECOND READER. The gates above hold what was quoted; a summary's claims are prose, so after them
 * `submit` has `diagnosis-audit.ts` name every clause that states as found what no evidence line shows, and refuses on its word —
 * at most twice per diagnosis, never when the auditor could not answer, and never once the diagnosis is over or has under a minute
 * left. It is handed the check's value, what it measures and its recent results (`givenFactsOf`), so a figure it was told is not an
 * invented one.
 *
 * `canRunFixes` is false for the hub: `center` runs no warden, so a proposal made for it could never be
 * run or promoted. `submit` refuses one with a sentence the agent reads and answers by resubmitting
 * with `proposal: null`, which is a better ending than a fix button that cannot work.
 *
 * Consumers: `diagnosis.service.ts`, which hands the result to `buildDiagnosisTools`.
 */

/** How many times the summary audit may refuse one diagnosis; the next submission goes through whatever it would say. */
const AUDIT_REFUSALS_ALLOWED = 2;

/**
 * The time the diagnosis must still have for an audit to start: the auditor's own 30 s and as long again for the agent to answer a
 * refusal. With less left the submission goes through unaudited, so the audit cannot be what runs a diagnosis into its ceiling.
 */
const AUDIT_ROOM_MS = 60_000;

/** A note is one sentence of at most 300 characters (`diagnosis-tools.ts`); the room above is for what masking adds, so a note is not cut for being masked. */
const NOTE_LIMIT = 400;

/** What a `history_read` was narrowed to, in the words of its step: the check's plain label (else its key), else the node, else every node. */
function historySubject(node: string | undefined, check: string | undefined): string {
  if (check === undefined) return node ?? 'every node';
  const known = cerberusDefinitionsDb.activeChecks(node).find((candidate) => candidate.key === check);
  return known?.label ?? check;
}

/**
 * Builds the tools' deps for the diagnosis `diagId` of a check on `node`. `linked` is whether the node's session opened.
 * `told` holds the system prompt once the agent has built it (`runDiagnosisAgent`'s `onPrompt`): the agent may quote the
 * check's own value and recent results from it as well as from its reads.
 */
export function buildDiagnosisToolDeps(input: {
  diagId: string;
  node: string;
  linked: boolean;
  canRunFixes: boolean;
  steps: DiagnosisStepLog;
  isOver: () => boolean;
  /** When the diagnosis hits its ceiling (epoch ms), and the signal that ends it: the summary audit starts only with `AUDIT_ROOM_MS` left and stops with the signal. */
  endsAt: number;
  signal: AbortSignal;
  told: { prompt: string };
}): CerberusDiagnosisToolDeps {
  const { diagId, node, linked, canRunFixes, steps, isOver, endsAt, signal, told } = input;
  // What the reads of this diagnosis returned, as the agent was handed it — and, apart, what the reads that SUCCEEDED returned:
  // a refusal or a failure is something the agent may quote in a note, but is no source for an evidence line.
  const answers: string[] = [];
  const found: string[] = [];
  /** How many submissions the summary audit has refused in this diagnosis. */
  let auditRefusals = 0;
  /** Throws, with the sentence the agent reads, when any of `texts` quotes words no read returned and the prompt does not hold. */
  const refuseUnreadQuotations = (texts: string[]): void => {
    const unread = unreadQuotations(texts, [...answers, told.prompt]);
    if (unread.length > 0) throw new Error(unreadQuotationsSentence(unread));
  };
  return {
    node,
    linked,
    callNode: async (tool, args) => {
      if (isOver()) throw new Error('the diagnosis has ended');
      steps.say(nodeReadStep(tool, args));
      const answer = await callNode(node, diagId, tool, args);
      answers.push(answer.text);
      if (answer.ok) found.push(answer.text);
      return answer;
    },
    historyRead: async (query) => {
      steps.say(historyReadStep(query, historySubject(query.node, query.check), Date.now()));
      const answer = readDiagnosisHistory(query);
      answers.push(answer);
      found.push(answer);
      return answer;
    },
    // A note is a finding on the sheet as the diagnosis runs — the live row's two notes carried the invented figure the
    // summary later did — so it is held to the reads and the prompt like the submission, and filed only when it passes.
    note: (text) => {
      refuseUnreadQuotations([text]);
      steps.say(oneMaskedLine(text, NOTE_LIMIT));
    },
    submit: async (submission) => {
      if (!canRunFixes && submission.proposal !== null) {
        throw new Error(`${node} runs no warden, so no fix can be run there. Submit proposal: null`);
      }
      if (submission.proposal !== null && [submission.proposal.cmd, submission.proposal.general].some(carriesCredential)) {
        throw new Error('A proposed command may not carry a credential');
      }
      const unquoted = unquotedLines(submission.evidence, found);
      if (unquoted.length > 0) throw new Error(unquotedSentence(unquoted));
      refuseUnreadQuotations([submission.summary, ...submission.evidence]);
      // The summary's prose is held last, by a second reader, and only twice: a third submission goes through (the audit is no reason for a diagnosis to fail).
      if (isOver()) throw new Error('the diagnosis has ended');
      if (auditRefusals >= AUDIT_REFUSALS_ALLOWED || endsAt - Date.now() < AUDIT_ROOM_MS) return;
      steps.say('Checking the summary against the evidence');
      const unsupported = await unsupportedClauses(submission, givenFactsOf(told.prompt), signal);
      if (unsupported === null || unsupported.length === 0) return;
      auditRefusals += 1;
      throw new Error(unsupportedSentence(unsupported));
    },
  };
}
