import { readChainRun, readRunDocument, readSoulRun, readSoulTranscript, type ChainRun, type ChainRunStage, type SoulRun } from '@/modules/dispatch-souls/index.js';
import { textResult, type ToolTextResult } from '@/shared/tool-text-result.js';
import { describeToolCall } from '@/shared/tool-call-hint.js';
import type { SubagentActivity } from '@/shared/types.js';
import { dispatchSoulsStateDir } from '@/shared/utils.js';

import type { CompanionToolDeps } from '../tools/companion-tools.js';

import { toPanel, wholeOrDigest } from './eyes-answer.js';
import { momentWords } from './run-list.js';
import type { ResolvedRun } from './run-resolve.js';
import { clipText, scrubCause, scrubDocument, scrubReport } from './run-scrub.js';
import { chainState, soulState, type RunState } from './run-state.js';

/**
 * THE FOUR SCOPES OF `read_run`, each answered from the run's own record (`readChainRun`, `readSoulRun`) and its own files:
 *   - `result`: the report without its cost line, then the newest builder stage's `result.md`, digested; a soul alone: its `result.md`;
 *   - `failure`: status, cause and failed stage, then that stage's result, digested when long;
 *   - `findings`: the report's gates line, then the newest review file with what the fix pass reported, digested;
 *   - `log`: one line per stage, then the end of `walker.out`, digested when long; a soul alone: its transcript, rendered and digested.
 * A digest is one dactyl under a FIXED brief (a short text is given whole). With `panel: true` the whole text goes to his panel as a
 * note instead and no dactyl runs. Every text passes `run-scrub.ts` first: no cost, provider, runtime or usage window reaches her (ruling 1).
 *
 * A scope names no chat and moves no focus or activity: a read runs as `thinking`. Consumer: `run-reads.ts` (`read_run`).
 */

/** The scope words `read_run` knows, in the order its schema tells them. Consumed by `run-reads.ts`. */
export const RUN_SCOPES = ['result', 'failure', 'findings', 'log'] as const;

const BUILDER_BRIEF = 'What did this builder report: what was built, what was shown working, and what is left open? At most 12 lines; cite L<n>.';
const SOUL_BRIEF = 'What did this agent report: what it did, what it showed working, and what is left open? At most 12 lines; cite L<n>.';
const FAILURE_BRIEF = 'Why did this stage fail, and what would set it right? At most 8 lines; cite L<n>.';
const FINDINGS_BRIEF = 'List every finding: its severity, one line, and whether the fix pass closed it. At most 15 lines; cite L<n>.';
/** The most characters of a task's title the head of an answer quotes. */
const TASK_HEAD_MAX = 80;

const LOG_BRIEF = 'What did this run do, step by step, and how did it end? At most 12 lines; cite L<n>.';

/** A text that is given whole when short and digested under `brief` when long; `label` names its scratch file; `intro` goes before it. */
type Digest = { text: string; label: string; brief: string; intro: string };

/** One piece of an answer: a sentence given as it is, or a text to be given whole or digested. */
type Part = string | Digest;


/**
 * Builds the answer from its parts. For his panel the parts are joined whole into one note (a digest's text unabridged) and she is
 * told it is there. Otherwise each digest runs in turn through `wholeOrDigest`; a digest that cannot be had is told as a line and the
 * facts before it stand, because a refusal there would hide the head of the answer she already has.
 */
async function answerOf(deps: CompanionToolDeps, panel: boolean, title: string, parts: Part[], signal: AbortSignal | undefined): Promise<ToolTextResult> {
  if (panel) {
    return toPanel(deps, title, textResult(parts.map((part) => (typeof part === 'string' ? part : `${part.intro}\n${part.text}`)).join('\n\n')));
  }
  const lines: string[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      lines.push(part);
      continue;
    }
    const digested = await wholeOrDigest(deps, part, signal);
    lines.push(digested.content.map((block) => block.text).join('\n'));
  }
  return textResult(lines.join('\n\n'));
}

/** The newest stage (the last in the record) whose name passes `wanted` and which has a result file. */
function newestStage(chain: ChainRun, wanted: (name: string) => boolean): ChainRunStage | null {
  return [...chain.stages].reverse().find((stage) => wanted(stage.name) && stage.text !== null) ?? null;
}

/** A chain's head line: its slug, its state and when. */
function chainHead(chain: ChainRun, state: RunState, run: ResolvedRun): string {
  const ended = state.kind === 'running' ? `out since ${momentWords(chain.started_at)}` : `last moved ${momentWords(chain.ended_at ?? chain.updated_at)}`;
  const task = run.task === null || run.plan === null ? '' : ` — ${run.plan} › ${clipText(run.task.title, TASK_HEAD_MAX)}`;
  return `Run ${chain.slug}${task}: ${state.words}, ${ended}.`;
}

/** A soul's head line. */
function soulHead(soul: SoulRun, state: RunState): string {
  return `Soul ${soul.agent} (${soul.role || 'no role'}): ${state.words}, ${state.kind === 'running' ? `out since ${momentWords(soul.started_at)}` : `ended ${momentWords(soul.ended_at ?? soul.started_at)}`}. It was handed: ${soul.brief || '(no brief line)'}`;
}

/** A document of a run's, read through the launcher's fence, without cost lines; `null` when the path is not one that can be read. */
function documentAt(path: string | null): string | null {
  const text = path === null ? null : readRunDocument(path);
  return text === null ? null : scrubDocument(text);
}

/** `result` of a chain: the report, then the newest builder stage's report, digested. */
function chainResult(chain: ChainRun, state: RunState, run: ResolvedRun): Part[] {
  const parts: Part[] = [chainHead(chain, state, run)];
  if (chain.report !== null) parts.push(scrubReport(chain.report).trim());
  // The builder stage, else the newest stage that left a result: a review-only or docs-only chain has no `builder`.
  const stage = newestStage(chain, (name) => name === 'builder') ?? newestStage(chain, () => true);
  const text = documentAt(stage?.text ?? null);
  if (stage === null || text === null) return [...parts, 'No result file of a stage is on record for this run.'];
  return [...parts, { text, label: 'run-result', brief: BUILDER_BRIEF, intro: `The ${stage.name} stage's report (attempt ${stage.attempt ?? 1}):` }];
}

/** `failure` of a chain: status, cause and failed stage, then that stage's result (or the end of the walker's log), digested when long. */
function chainFailure(chain: ChainRun, state: RunState, run: ResolvedRun): Part[] {
  if (state.kind === 'done') return [`${chainHead(chain, state, run)} It did not fail.`];
  if (state.kind === 'running') return [`${chainHead(chain, state, run)} It has not failed; it is still going.`];
  const stageName = chain.failed_stage ?? chain.stage;
  const facts = [`Status: ${chain.status}.`, chain.cause === '' ? null : `Cause: ${scrubCause(chain.cause)}.`, stageName === null ? null : `Failed stage: ${stageName}.`]
    .filter((fact) => fact !== null)
    .join(' ');
  const parts: Part[] = [`${chainHead(chain, state, run)} ${facts}`];
  const stage = newestStage(chain, (name) => name === stageName);
  const text = documentAt(stage?.text ?? null);
  if (text !== null) return [...parts, { text, label: 'run-failure', brief: FAILURE_BRIEF, intro: `The ${stageName} stage's own report:` }];
  const tail = scrubReport(chain.walker_tail).trim();
  if (tail === '') return [...parts, 'That stage left no result file, and the walker wrote nothing.'];
  return [...parts, { text: tail, label: 'run-failure', brief: FAILURE_BRIEF, intro: "That stage left no result file; the end of the walker's log:" }];
}

/** `findings` of a chain: the gates line, then the newest review file with what the fix pass reported, digested. */
function chainFindings(chain: ChainRun, state: RunState, run: ResolvedRun): Part[] {
  const gates = /^\s*gates:.*$/m.exec(scrubReport(chain.report ?? ''))?.[0]?.trim() ?? null;
  const head = `${chainHead(chain, state, run)}${gates === null ? '' : ` ${gates}`}`;
  const reviewStage = [...chain.stages].reverse().find((stage) => stage.findings !== null);
  // The report names the review files too; a walk that stopped before its report still has them on its stages.
  const reviewPath = reviewStage?.findings ?? [...chain.paths].reverse().find((entry) => entry.includes('/pipeline-reviews/')) ?? null;
  if (reviewPath === null) return [`${head} No review file is on record: no review stage has answered.`];
  const review = documentAt(reviewPath);
  if (review === null) return [`${head} The review file is not readable.`];
  // The review file cannot say what the fix pass closed: the report of the fix pass that CAME AFTER this review is appended so the digest
  // can. A fix pass from an earlier round never saw this review's findings, so it is not offered as having closed them.
  const after = reviewStage === undefined ? chain.stages : chain.stages.slice(chain.stages.indexOf(reviewStage) + 1);
  const fix = [...after].reverse().find((stage) => stage.name.startsWith('fix') && stage.text !== null) ?? null;
  const fixText = documentAt(fix?.text ?? null);
  const name = reviewStage?.name ?? 'review';
  if (fixText === null) return [head, { text: review, label: 'run-findings', brief: FINDINGS_BRIEF, intro: `The newest review (${name}); no fix pass has reported on it:` }];
  const text = `${review.trimEnd()}\n\n---\n\n# What the fix pass reported (stage ${fix?.name}, after this review)\n\n${fixText}`;
  return [head, { text, label: 'run-findings', brief: FINDINGS_BRIEF, intro: `The newest review (${name}), with what the fix pass reported:` }];
}

/** The status words of a stage in a log line: `waiting` means the stage's soul is out. */
const stageStatusWords = (status: string): string => (status === 'waiting' ? 'running' : status || 'no status');

/** `log` of a chain: one line per stage, then the end of the walker's log, digested when long. */
function chainLog(chain: ChainRun, state: RunState, run: ResolvedRun): Part[] {
  const stages = chain.stages.map((stage) => `${stage.name} · attempt ${stage.attempt ?? 1} · ${stageStatusWords(stage.status)} · ${stage.verdict ?? '—'} · ${stage.at === null ? 'not started' : momentWords(stage.ended_at ?? stage.at)}`);
  const parts: Part[] = [chainHead(chain, state, run), stages.length === 0 ? 'No stage has started.' : stages.join('\n')];
  const tail = scrubReport(chain.walker_tail).trim();
  if (tail !== '') parts.push({ text: tail, label: 'run-log', brief: LOG_BRIEF, intro: "The end of the walker's log:" });
  return parts;
}

/** A soul's transcript as text: what it said and, one line each, the tools it called; its thinking is left out. */
function transcriptText(activity: SubagentActivity[]): string {
  return activity
    .flatMap((entry) => {
      if (entry.kind === 'text') return entry.content?.trim() ? [entry.content.trim()] : [];
      if (entry.kind === 'tool') return [`→ ${describeToolCall(entry.toolName ?? 'tool', entry.toolInput)}`];
      return [];
    })
    .join('\n\n');
}

/** A soul alone, per scope. */
async function soulScope(scope: string, soul: SoulRun, state: RunState): Promise<Part[]> {
  const head = soulHead(soul, state);
  const result = documentAt(soul.result_path);
  switch (scope) {
    case 'result':
      return result === null ? [head, 'It has left no result file yet.'] : [head, { text: result, label: 'run-result', brief: SOUL_BRIEF, intro: 'Its report:' }];
    case 'failure': {
      if (state.kind === 'done') return [`${head} It did not fail.`];
      if (state.kind === 'running') return [`${head} It has not failed; it is still going.`];
      const facts = `Status: ${soul.status || 'none'}.${soul.cause === '' ? '' : ` Cause: ${scrubCause(soul.cause)}.`}`;
      return result === null ? [`${head} ${facts}`, 'It left no result file.'] : [`${head} ${facts}`, { text: result, label: 'run-failure', brief: FAILURE_BRIEF, intro: 'Its own report:' }];
    }
    case 'findings':
      return [`${head} A soul alone has no review file; read_run with scope result gives its report.`];
    default: {
      const transcript = await readSoulTranscript(dispatchSoulsStateDir(), soul.launch_id);
      const text = transcript.found ? transcriptText(transcript.activity) : '';
      if (text === '') return [head, 'No transcript is on record for this soul.'];
      return [head, { text, label: 'run-log', brief: LOG_BRIEF, intro: `Its transcript (${transcript.total} steps${transcript.inFlight ? ', still going' : ''}):` }];
    }
  }
}

/**
 * One scope of one resolved run, as the answer she is handed (or the note on his panel). `scope` is one of `RUN_SCOPES`, already
 * judged by the caller. A run whose record is gone since it was resolved is a refusal that says so. Reads files and runs at most the
 * digests the scope names (one for `result`, `failure`, `findings`, `log` of a chain; one for a soul).
 * Consumed by `run-reads.ts` (`read_run`).
 */
export async function readRunScope(deps: CompanionToolDeps, run: ResolvedRun, scope: string, panel: boolean, signal: AbortSignal | undefined): Promise<ToolTextResult> {
  const nowS = Date.now() / 1000;
  if (run.kind === 'soul') {
    const soul = readSoulRun(run.id);
    if (soul === null) return deps.refuse(`The files of ${run.id} have been cleared from disk, so there is nothing left to read of it; call list_runs for the runs there are.`);
    const parts = await soulScope(scope, soul, soulState(soul.role, soul.state));
    return answerOf(deps, panel, `Soul ${soul.agent}: ${scope}`, parts, signal);
  }
  const chain = readChainRun(run.id);
  if (chain === null) return deps.refuse(`The files of ${run.id} have been cleared from disk, so there is nothing left to read of it; call list_runs for the runs there are.`);
  const state = chainState(chain, nowS);
  const parts = scope === 'result' ? chainResult(chain, state, run)
    : scope === 'failure' ? chainFailure(chain, state, run)
      : scope === 'findings' ? chainFindings(chain, state, run)
        : chainLog(chain, state, run);
  return answerOf(deps, panel, `Run ${chain.slug}: ${scope}`, parts, signal);
}
