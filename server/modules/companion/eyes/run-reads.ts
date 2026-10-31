import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { isRecord } from '@/shared/document-fields.js';
import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import { toolLine } from '../session/companion-prompt.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';

import { LIST_ABOUT_NOTHING } from './card-shapes.js';
import { cappedLines, toPanel } from './eyes-answer.js';
import { runLines, runScopeOf, RUNS_MAX } from './run-list.js';
import { resolveRun } from './run-resolve.js';
import { readRunScope, RUN_SCOPES } from './run-scopes.js';

/**
 * Her eyes on the RUNS: `list_runs` and `read_run`. A run is what the dispatcher walked for a plan's task, or a soul or a chain
 * a chat launched by hand; the list says one line each, the read answers one run by one scope (`run-scopes.ts`).
 *
 * `list_runs(scope)` — `running`, `recent` (ended in the last 24 hours), `failed` (ended without finishing in the last 7 days),
 * or a phrase over the plan, the task, the agent, the brief's first words and the chat's name; at most 15 lines (`run-list.ts`).
 * `read_run(run, scope)` — a run by the id the list prints or by `<plan> <task key or title>` (`run-resolve.ts`), and
 * `result`, `failure`, `findings` or `log`; a long answer comes back as a dactyl's digest under a fixed brief.
 * Both take `panel: true` to put the whole answer on his panel instead of in her context.
 *
 * NO RUN READ MOVES HER FOCUS OR HER ACTIVITY (ruling 4): a run names no chat of the sessions she keeps, and a read runs as
 * `thinking`. NEVER A COST (ruling 1): no line carries spend, tokens, provider or runtime, and every digest brief forbids them.
 * Each description is her prompt's own line for the tool (`toolLine`); the readers are the dispatcher's, the souls lane's and
 * the launcher's own records, never the runner's `--status`, which adopts a dead walker's stage.
 *
 * Consumer: `tools/companion-tools.ts` (`buildCompanionTools`), once per account.
 */

/** The call's own AbortSignal, when the SDK hands one in the handler's second argument (it does for a cancelled call, as when she is stopped). */
function signalOf(extra: unknown): AbortSignal | undefined {
  const signal = isRecord(extra) ? extra.signal : undefined;
  return signal instanceof AbortSignal ? signal : undefined;
}

/** `list_runs`: the runs of a scope, a line each, newest first with the ones still out ahead, at most 15. */
function listRuns(deps: CompanionToolDeps, args: { scope: string; panel?: boolean }): Promise<ToolTextResult> {
  return guardedToolResult('list_runs', 'read the runs', async () => {
    const scope = runScopeOf(args.scope);
    const { lines, notes, none } = await runLines(deps.house, scope, Date.now() / 1000);
    const text = [...notes, lines.length === 0 ? none : cappedLines(lines, RUNS_MAX)].join('\n');
    return args.panel === true ? toPanel(deps, `Runs: ${args.scope.trim()}`, textResult(text), LIST_ABOUT_NOTHING) : textResult(text);
  });
}

/** `read_run`: resolves the run, judges the scope, and answers it. A run or a scope that cannot be had is a refusal that says what to do next. */
function readRun(deps: CompanionToolDeps, args: { run: string; scope: string; panel?: boolean }, signal: AbortSignal | undefined): Promise<ToolTextResult> {
  return guardedToolResult('read_run', 'read the run', async () => {
    const scope = args.scope.trim().toLowerCase();
    if (!(RUN_SCOPES as readonly string[]).includes(scope)) {
      return deps.refuse(`scope is ${RUN_SCOPES.slice(0, -1).join(', ')} or ${RUN_SCOPES.at(-1)}; "${args.scope.trim()}" is none of them.`);
    }
    const resolved = await resolveRun(deps.house, args.run);
    if (!resolved.ok) return deps.refuse(resolved.sentence);
    return readRunScope(deps, resolved.run, scope, args.panel === true, signal);
  });
}

/** The panel flag both tools take: the answer goes on his panel as a card instead of into her context. */
const panelFlag = z.boolean().optional().describe('true puts the whole answer on his panel as a card and tells you only that it is there; leave out to read it yourself.');

/**
 * The definitions of `list_runs` and `read_run`, built with the SDK's `tool()` and zod. Both are marked read-only: they change
 * nothing of his and the CLI never asks about them. Consumed by `tools/companion-tools.ts` (`buildCompanionTools`), once per account.
 */
export function runReads(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  const readOnly = { annotations: { readOnlyHint: true } };
  return [
    tool(
      'list_runs',
      toolLine('list_runs'),
      {
        scope: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            "running: what is out right now. recent: what ended in the last 24 hours. failed: what ended without finishing in the last 7 days. A chat's own runs are kept only six hours after they end, so recent and failed hold the plans' tasks for the whole span and a chat's runs for the last six hours. Anything else is a phrase over the plan, the task, the agent, the brief and the chat name."
          ),
        panel: panelFlag,
      },
      (args) => listRuns(deps, args),
      readOnly
    ),
    tool(
      'read_run',
      toolLine('read_run'),
      {
        run: z
          .string()
          .trim()
          .min(1)
          .max(300)
          .describe("The run's id as list_runs prints it (after \"run \"), or its plan and its task: the plan's name or title, then the task's key or title."),
        scope: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .describe('result: the run\'s report and what its builder reported. failure: why it failed. findings: the review\'s findings and what the fix pass closed. log: its stages and how the walk went.'),
        panel: panelFlag,
      },
      (args, extra) => readRun(deps, args, signalOf(extra)),
      readOnly
    ),
  ];
}
