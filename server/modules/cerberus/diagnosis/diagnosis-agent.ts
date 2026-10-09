import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSdkMcpServer, query, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

import { cerberusResultsDb } from '@/modules/database/index.js';
import { userFacingEnv } from '@/shared/child-env.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { CerberusCheckView, CerberusDiagnosisSubmission } from '@/shared/cerberus-types.js';

import { fixesOfCheck } from '../read-model/catalog-views.js';

import { describeMeasurement } from './diagnosis-measurement.js';
import { buildDiagnosisSystemPrompt } from './diagnosis-prompt.js';
import {
  DIAGNOSIS_MCP_SERVER_NAME,
  DIAGNOSIS_NODE_TOOL_NAMES,
  DIAGNOSIS_READ_BUDGET,
  DIAGNOSIS_SUBMIT_TOOL_NAME,
} from './diagnosis-tools.js';

/**
 * The diagnosing agent: one `query()` that reads a failing check through the six tools of
 * `diagnosis-tools.ts` and ends by submitting a diagnosis. READ-ONLY IS TRUE BY CONSTRUCTION, and each
 * option below is one of the reasons:
 *   - `tools: []` — no built-in tool exists: no shell, no file edit, no web. The six MCP tools are
 *     everything it has, and none of them changes anything.
 *   - `allowedTools` — exactly the MCP tools it was built with, so a tool is never one prompt away.
 *   - `settingSources: []` — no house hook, CLAUDE.md or skill runs inside it, and nothing on disk
 *     widens what it may do.
 *   - `strictMcpConfig` — the one MCP server is the one passed here; the operator's own MCP servers
 *     (`~/.claude.json`) are not loaded into a session whose whole point is a short list of reads.
 *   - `persistSession: false` — it never becomes a chat. A diagnosis's prompt is Cerberus's, not the
 *     operator's, and a transcript of it would be walked by the heal reading as if he had said it.
 *   - `cwd` under `~/.claude/state` — a hidden project root (`hidden-project-paths.ts`), so even a
 *     session that did register would never reach a project list. Nothing is read from it.
 *   - `maxTurns: 24`, and the caller's abort signal — a diagnosis cannot run on.
 * And one check made at run time rather than trusted: the CLI's own `init` message lists every tool
 * the session has, and a list that holds anything but this agent's MCP tools ends the diagnosis before
 * the model sees a turn (`unexpected_tools`).
 *
 * The answer is the submission, or a rejection with the reason (`DiagnosisAgentFailure`).
 *
 * Consumers: the diagnosis service (`startDiagnosis` runs it and files what it answers).
 */

/** The turn ceiling: enough for a dozen reads, a few notes and the submission, not enough to wander. */
const DIAGNOSIS_MAX_TURNS = 24;

/** How many of the check's last stored changes the prompt quotes. */
const PROMPT_CHANGE_COUNT = 20;

/** What a diagnosis that was stopped says, whether it was stopped before it began or while it ran. */
const STOPPED_SENTENCE = 'The diagnosis was stopped before it submitted an answer.';

/**
 * A message from the SDK or the CLI as one sentence for the tab: its own closing period dropped before
 * ours is added, and the CLI's advice about a flag ("Run --model to pick a different model.") left out —
 * the operator has no flag to pass.
 */
function sentenceFrom(message: string): string {
  const withoutAdvice = message.replace(/\s*Run --model\b[^.]*\.?\s*$/i, '');
  return `${withoutAdvice.replace(/[.\s]+$/, '')}.`;
}

/** The model a diagnosis reads with when the caller names none, until `CERBERUS_DIAG_MODEL` says otherwise. */
const DEFAULT_DIAGNOSIS_MODEL = 'sonnet';

/**
 * Why a diagnosis agent ended without a submission, in the words the tab shows: `no_submission` (it
 * stopped talking without calling `submit_diagnosis`), `turn_ceiling` (24 turns and no submission),
 * `aborted` (the caller's signal fired — the 3-minute ceiling, a lost link, a shutdown),
 * `unexpected_tools` (the session held a tool it should not have) or `error` (the CLI or the API
 * failed). `message` is one sentence for a person.
 *
 * Consumers: the diagnosis service, which stores `message` as the failed diagnosis's `error`.
 */
export class DiagnosisAgentFailure extends Error {
  readonly reason: 'no_submission' | 'turn_ceiling' | 'aborted' | 'unexpected_tools' | 'error';

  constructor(reason: DiagnosisAgentFailure['reason'], message: string) {
    super(message);
    this.name = 'DiagnosisAgentFailure';
    this.reason = reason;
  }
}

/**
 * The model a diagnosis runs on: the one asked for, else `CERBERUS_DIAG_MODEL`, else `sonnet`.
 *
 * Consumers: `runDiagnosisAgent` here, and the diagnosis service, which records the same answer in the
 * `diagnoses` row's `model` — one function, so the row and the run cannot disagree.
 */
export function resolveDiagnosisModel(requested?: string | null): string {
  return requested || process.env.CERBERUS_DIAG_MODEL || DEFAULT_DIAGNOSIS_MODEL;
}

/**
 * `~/.claude/state/cerberus-diag`, made if absent: a hidden root the agent is launched in and reads nothing from.
 *
 * Consumers: `runDiagnosisAgent` here, and `diagnosis-audit.ts`, whose summary audit is one more session that must never become a chat.
 */
export function diagnosisWorkingDirectory(): string {
  const directory = path.join(os.homedir(), '.claude', 'state', 'cerberus-diag');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

/**
 * Wraps the tool that ends the diagnosis so that the submission it ACCEPTED is kept: the tool's own
 * handler runs first (it files the conclusion and may refuse it), and only a call it did not refuse
 * counts. Every other tool is passed through untouched.
 */
function captureSubmission(
  tools: Array<SdkMcpToolDefinition<any>>,
  onSubmission: (submission: CerberusDiagnosisSubmission) => void
): Array<SdkMcpToolDefinition<any>> {
  return tools.map((definition) => {
    if (definition.name !== DIAGNOSIS_SUBMIT_TOOL_NAME) return definition;
    return {
      ...definition,
      handler: async (args, extra) => {
        const answer = await definition.handler(args, extra);
        // The SDK has validated `args` against the tool's schema before the handler runs. The tool refuses
        // a second call itself; `onSubmission` keeps the first all the same.
        if (!answer.isError) onSubmission(args as CerberusDiagnosisSubmission);
        return answer;
      },
    };
  });
}

/**
 * Runs one diagnosis of `check` on `node` and answers what the agent submitted. `tools` come from
 * `buildDiagnosisTools` (without the node's three reads when the warden is not connected); `model`
 * defaults per `resolveDiagnosisModel`; `signal` ends it. Rejects with a `DiagnosisAgentFailure`
 * when the agent submits nothing, reaches the turn ceiling, is aborted or cannot run.
 */
export async function runDiagnosisAgent(input: {
  check: CerberusCheckView;
  node: string;
  model?: string | null;
  tools: Array<SdkMcpToolDefinition<any>>;
  signal: AbortSignal;
  /** Handed the system prompt once it is built, before the model sees a turn: what the agent may quote besides its reads. */
  onPrompt?: (systemPrompt: string) => void;
}): Promise<CerberusDiagnosisSubmission> {
  const { check, node, signal } = input;
  // A signal that has already fired spawns nothing: no CLI process, no model request.
  if (signal.aborted) throw new DiagnosisAgentFailure('aborted', STOPPED_SENTENCE);
  const model = resolveDiagnosisModel(input.model);

  // A holder, not a `let`: the submit tool's handler fills it from inside the SDK's call.
  const accepted: { submission: CerberusDiagnosisSubmission | null } = { submission: null };
  const tools = captureSubmission(input.tools, (submission) => {
    accepted.submission ??= submission;
  });
  const mcpToolNames = tools.map((definition) => `mcp__${DIAGNOSIS_MCP_SERVER_NAME}__${definition.name}`);

  const systemPrompt = buildDiagnosisSystemPrompt({
    check,
    node,
    nodeToolsOpen: tools.some((definition) => DIAGNOSIS_NODE_TOOL_NAMES.includes(definition.name)),
    changes: cerberusResultsDb.recentChanges(check.node, check.key, 0, PROMPT_CHANGE_COUNT),
    measures: describeMeasurement(check),
    fixes: fixesOfCheck(check.node, check.key),
    now: Date.now(),
    maxTurns: DIAGNOSIS_MAX_TURNS,
    readBudget: DIAGNOSIS_READ_BUDGET,
  });
  input.onPrompt?.(systemPrompt);

  // Everything that can throw before the session starts comes first, so nothing is left listening on the caller's signal.
  const cwd = diagnosisWorkingDirectory();
  const executable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);

  // The SDK takes a controller, the caller gives a signal: one follows the other. Nothing between the
  // `aborted` check above and this listener awaits, so the signal cannot fire unseen in between.
  const abortController = new AbortController();
  const followCaller = (): void => abortController.abort(signal.reason);
  signal.addEventListener('abort', followCaller, { once: true });

  const conversation = query({
    prompt: `Diagnose the check "${check.label ?? check.key}" (${check.key}) on ${node}. Call submit_diagnosis when you have your answer.`,
    options: {
      model,
      systemPrompt,
      tools: [],
      mcpServers: { [DIAGNOSIS_MCP_SERVER_NAME]: createSdkMcpServer({ name: DIAGNOSIS_MCP_SERVER_NAME, tools }) },
      strictMcpConfig: true,
      allowedTools: mcpToolNames,
      settingSources: [],
      persistSession: false,
      cwd,
      maxTurns: DIAGNOSIS_MAX_TURNS,
      abortController,
      env: userFacingEnv(),
      ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
    },
  });

  try {
    for await (const message of conversation) {
      if (accepted.submission) break;

      if (message.type === 'system' && message.subtype === 'init') {
        const strangers = message.tools.filter((name) => !mcpToolNames.includes(name));
        if (strangers.length > 0) {
          throw new DiagnosisAgentFailure(
            'unexpected_tools',
            `The diagnosis session held tools it should not have (${strangers.join(', ')}), so it was not run.`
          );
        }
      } else if (message.type === 'result' && message.subtype !== 'success') {
        const ceiling = message.subtype === 'error_max_turns';
        throw new DiagnosisAgentFailure(
          ceiling ? 'turn_ceiling' : 'error',
          ceiling
            ? `The diagnosis used its ${DIAGNOSIS_MAX_TURNS} turns without submitting an answer.`
            : `The diagnosis agent stopped on an error: ${sentenceFrom(message.errors.join('; ') || message.subtype)}`
        );
      }
    }
  } catch (error) {
    // An abort surfaces as whatever the SDK throws while its process is torn down; the caller's signal is the truth.
    if (signal.aborted) throw new DiagnosisAgentFailure('aborted', STOPPED_SENTENCE);
    if (error instanceof DiagnosisAgentFailure) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[Cerberus] the diagnosis agent failed', { node, check: check.key, model, error: reason });
    throw new DiagnosisAgentFailure('error', `The diagnosis agent could not run: ${sentenceFrom(reason)}`);
  } finally {
    signal.removeEventListener('abort', followCaller);
    conversation.close();
  }

  if (accepted.submission) return accepted.submission;
  if (signal.aborted) throw new DiagnosisAgentFailure('aborted', STOPPED_SENTENCE);
  throw new DiagnosisAgentFailure('no_submission', 'The diagnosis agent finished without submitting an answer.');
}
