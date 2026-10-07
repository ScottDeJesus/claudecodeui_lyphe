import { cerberusDefinitionsDb } from '@/modules/database/index.js';
import type { CerberusDiagnosisToolDeps } from '@/shared/cerberus-types.js';

import { historyReadStep, nodeReadStep } from './diagnosis-step-words.js';
import type { DiagnosisStepLog } from './diagnosis-steps.js';
import { readDiagnosisHistory } from './diagnosis-history.js';
import { unreadQuotations, unreadQuotationsSentence } from './diagnosis-quotes.js';
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
 * `canRunFixes` is false for the hub: `center` runs no warden, so a proposal made for it could never be
 * run or promoted. `submit` refuses one with a sentence the agent reads and answers by resubmitting
 * with `proposal: null`, which is a better ending than a fix button that cannot work.
 *
 * Consumers: `diagnosis.service.ts`, which hands the result to `buildDiagnosisTools`.
 */

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
  told: { prompt: string };
}): CerberusDiagnosisToolDeps {
  const { diagId, node, linked, canRunFixes, steps, isOver, told } = input;
  // What the reads of this diagnosis returned, as the agent was handed it.
  const answers: string[] = [];
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
      return answer;
    },
    historyRead: async (query) => {
      steps.say(historyReadStep(query, historySubject(query.node, query.check), Date.now()));
      const answer = readDiagnosisHistory(query);
      answers.push(answer);
      return answer;
    },
    // A note is a finding on the sheet as the diagnosis runs — the live row's two notes carried the invented figure the
    // summary later did — so it is held to the reads and the prompt like the submission, and filed only when it passes.
    note: (text) => {
      refuseUnreadQuotations([text]);
      steps.say(text);
    },
    submit: (submission) => {
      if (!canRunFixes && submission.proposal !== null) {
        throw new Error(`${node} runs no warden, so no fix can be run there. Submit proposal: null`);
      }
      refuseUnreadQuotations([submission.summary, ...submission.evidence]);
    },
  };
}
