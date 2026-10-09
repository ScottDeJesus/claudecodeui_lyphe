import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { CerberusDiagnosisToolDeps, CerberusDiagTool } from '@/shared/cerberus-types.js';

import { LONE_SURROGATE } from '../catalog-entry-input.js';

/**
 * The six tools of the diagnosing agent, as the SDK's `tool()` builds them. The agent has NO built-in
 * tool (`tools: []` in `diagnosis-agent.ts`), so this list is everything it can do, and none of it
 * changes anything:
 *   - `log_read`, `file_read` and `status_read` go to the node's warden as a fixed menu of argv reads
 *     (`diag.call`), open only while this node's diagnosis is. They exist only for a node that is
 *     connected — a diagnosis of an unreachable node simply has no way to ask.
 *   - `history_read` answers from the Cerberus store, every node at once.
 *   - `note` and `submit_diagnosis` are center's own: one files a finding, the other ends the diagnosis.
 *
 * WHY THE SCHEMAS CARRY THE WARDEN'S RANGES. The warden validates every argument and is the authority
 * (it answers `ok: false` with a sentence for anything out of range); the ranges are repeated here so
 * the model's JSON schema tells it the limits before it spends a turn on a refusal. An argument the
 * model leaves out is left out of the call: the warden applies its own defaults, and the step line the
 * tab shows is written from what was actually sent.
 *
 * A read's failure is an ANSWER, not an exception: a refused or failed read comes back as an error
 * result the agent reads and works around, and a read that could not be asked at all (the link went)
 * likewise — the loop's own link-lost handling is what fails the diagnosis, not a tool throwing. A
 * read the warden never answers is bounded here (`NODE_READ_TIMEOUT_MS`), so the agent hears of it and
 * can go on with history instead of waiting for the loop's 3-minute ceiling.
 *
 * A READ BUDGET keeps a diagnosis convergent. The turn ceiling (24) ends one that never submits, but a
 * model that explores — the first measured diagnosis on Haiku read twenty-four directories and journals
 * and never concluded — spends its operator's usage for an answer of "failed". So the four reads (the
 * node's three and history) share a budget of `DIAGNOSIS_READ_BUDGET`: from the eighth on, every answer
 * says how many are left and that `submit_diagnosis` may come now, and once it is spent a read is refused
 * with the instruction to submit what was found. A `note` and the submission are never counted, and the
 * budget sits well inside the turn ceiling, so the agent always has turns left to conclude in.
 *
 * `submit_diagnosis` ends the diagnosis ONCE: the first accepted call is the answer, a second (parallel
 * calls arrive together) is refused without reaching `deps.submit`. It also refuses what the store and
 * the catalog would later: a proposal with no evidence behind it (a fix with no cause found is a
 * guess), and text with half a character in it or, for a note and a button name, a line break.
 *
 * Consumers: `diagnosis-agent.ts` (`DIAGNOSIS_NODE_TOOL_NAMES` and `DIAGNOSIS_SUBMIT_TOOL_NAME` to
 * tell the node's reads and the conclusion from the rest of the list) and the diagnosis service, which
 * calls `buildDiagnosisTools` with the diagnosis's own `deps`.
 */

/** The name the MCP server is registered under; the SDK exposes each tool to the model as `mcp__cerberus__<name>`. */
export const DIAGNOSIS_MCP_SERVER_NAME = 'cerberus';

/** The tools that reach the node's warden — the ones left out when the node is not linked. */
export const DIAGNOSIS_NODE_TOOL_NAMES: readonly string[] = ['log_read', 'file_read', 'status_read'];

/** The tool that ends a diagnosis: `diagnosis-agent.ts` listens for it to answer the submission. */
export const DIAGNOSIS_SUBMIT_TOOL_NAME = 'submit_diagnosis';

/**
 * How many reads — the node's three tools and `history_read` together — one diagnosis may make. Sixteen is
 * generous for "a few targeted reads", and leaves most of the 24 turns for the notes and the submission even
 * when each turn makes a single read. Consumers: `diagnosis-prompt.ts`, which tells the agent the number.
 */
export const DIAGNOSIS_READ_BUDGET = 16;

/** From this many reads on, every answer says how many are left. */
const BUDGET_NUDGE_FROM = 8;

/**
 * How the note under an answer begins. It is center's, not the node's, and the words say so: a note shaped like a log
 * line (`[read 8 of 16: 8 left …]`, set straight under a journal's last line) was read as the end of that line and
 * quoted as journal text. The blank line sets it apart, and `diagnosis-deps.ts` never counts it as something read.
 */
const BUDGET_NOTE_LEAD = '\n\nNote from Cerberus — not part of the answer above:';

/**
 * How large one tool answer may be before the bundled CLI stops handing it to the model inline. The CLI keeps an MCP tool
 * result in the conversation only up to a per-tool limit (`_meta['anthropic/maxResultSizeChars']`); a larger one is written
 * under `~/.claude/projects/<cwd>/<session>/tool-results/` and the model is given a preview with a path it has no Read tool to
 * open (the live 64 KB `file_read` left 65,514 bytes of masked text there, and the next step re-read the log as a 100-line
 * tail). The warden caps an answer at 64 KiB (`OUTPUT_CAP_BYTES`, so at most 65,536 characters) and the tool adds its own
 * framing under it, so 72,000 holds the biggest answer a read can make.
 */
const MAX_RESULT_SIZE_CHARS = 72_000;

/**
 * `definition` with the result limit above. The SDK's `tool()` takes no `_meta`, but the definition object it returns
 * carries one (`SdkMcpToolDefinition._meta`) and the CLI reads that key; `tool()` builds a plain object, so spreading it
 * loses nothing.
 */
function keepAnswersInline(definition: SdkMcpToolDefinition<any>): SdkMcpToolDefinition<any> {
  return { ...definition, _meta: { ...definition._meta, 'anthropic/maxResultSizeChars': MAX_RESULT_SIZE_CHARS } };
}

/** `history_read` without a `limit` answers this many lines. */
const DEFAULT_HISTORY_LIMIT = 50;

/**
 * How long a read of the node may go unanswered before the agent is told so. The warden kills a read at
 * 10 s and answers it, so silence past this means a frame was lost — in practice a dead link.
 */
const NODE_READ_TIMEOUT_MS = 15_000;

/** A systemd unit's name, as the warden accepts it. */
const UNIT_NAME = /^[A-Za-z0-9@._-]+$/;

/**
 * A trimmed, non-empty string of at most `max` characters that the store and the catalog can keep as
 * typed: no half of a character (`LONE_SURROGATE`) and, with `singleLine`, no line break. A schema
 * refusal names the field and the reason to the agent, which corrects it and submits again.
 */
function plainText(max: number, { singleLine = false }: { singleLine?: boolean } = {}) {
  const text = z.string().trim().min(1).max(max).refine((value) => !LONE_SURROGATE.test(value), 'holds half of a character');
  return singleLine ? text.refine((value) => !/[\r\n]/.test(value), 'must be one line') : text;
}

type ToolText = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function textResult(text: string, isError = false): ToolText {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Builds the agent's tools over `deps`. The three node reads are left out when `deps.linked` is false;
 * the other three are always there. The array's order is the order the model is shown them.
 */
export function buildDiagnosisTools(deps: CerberusDiagnosisToolDeps): Array<SdkMcpToolDefinition<any>> {
  // Counted when a read is ASKED for, synchronously, so parallel calls of one turn each take their own place.
  let readsUsed = 0;

  /**
   * Spends one read of the budget on `read`: its answer, with the budget's state appended from the eighth
   * read on — or, with none left, the refusal that tells the agent to submit.
   */
  async function withinBudget(read: () => Promise<ToolText>): Promise<ToolText> {
    if (readsUsed >= DIAGNOSIS_READ_BUDGET) {
      return textResult(
        `All ${DIAGNOSIS_READ_BUDGET} reads are used. Call submit_diagnosis now with what you found — an empty evidence list and proposal: null if nothing explains the check.`,
        true
      );
    }
    readsUsed += 1;
    const answer = await read();
    if (readsUsed < BUDGET_NUDGE_FROM) return answer;
    const left = DIAGNOSIS_READ_BUDGET - readsUsed;
    const advice =
      left === 0
        ? `${BUDGET_NOTE_LEAD} that was your last read of ${DIAGNOSIS_READ_BUDGET} — call submit_diagnosis now.`
        : `${BUDGET_NOTE_LEAD} ${readsUsed} of ${DIAGNOSIS_READ_BUDGET} reads used, ${left} left — if you can say what is wrong, call submit_diagnosis now.`;
    return { ...answer, content: [...answer.content, { type: 'text', text: advice }] };
  }

  /** One read of the node: the warden's answer as a tool result, its refusals as errors the agent reads. */
  async function readFromNode(wireTool: CerberusDiagTool, args: Record<string, unknown>): Promise<ToolText> {
    let giveUp: NodeJS.Timeout | undefined;
    try {
      const unanswered = new Promise<never>((_resolve, reject) => {
        giveUp = setTimeout(
          () => reject(new Error(`${deps.node} did not answer within ${NODE_READ_TIMEOUT_MS / 1000} s`)),
          NODE_READ_TIMEOUT_MS
        );
      });
      const answer = await Promise.race([deps.callNode(wireTool, args), unanswered]);
      const body = answer.text === '' ? '(no output)' : answer.text;
      return textResult(answer.truncated ? `${body}\n[truncated: the read was cut at its size limit]` : body, !answer.ok);
    } catch (error) {
      console.error('[Cerberus] a diagnosis read of the node could not be answered', { node: deps.node, tool: wireTool, error: describe(error) });
      return textResult(`The read could not be completed: ${describe(error)}`, true);
    } finally {
      clearTimeout(giveUp);
    }
  }

  const logRead = tool(
    'log_read',
    `Read a log on ${deps.node}: either a systemd unit's journal (give unit) or the last lines of a log file (give path) — one of the two. ` +
      'Window: sinceMin minutes back (default 15, at most 1440) and at most lines lines (default 200, at most 500). contains keeps only the lines holding that text.',
    {
      unit: z.string().regex(UNIT_NAME).max(200).optional().describe('A systemd unit name, e.g. docstore.service'),
      path: z.string().min(1).max(4096).optional().describe('An absolute path to a log file'),
      sinceMin: z.number().int().min(1).max(1440).optional().describe('Minutes back from now (journal reads)'),
      lines: z.number().int().min(1).max(500).optional().describe('The most lines to return'),
      contains: z.string().min(1).max(200).optional().describe('Keep only lines containing this text'),
    },
    (args) => withinBudget(() => readFromNode('log.read', args))
  );

  const fileRead = tool(
    'file_read',
    `Read a regular text file on ${deps.node} (its first whole lines within maxBytes bytes, default 65536) or list a directory (name, type, size, modified; up to 200 entries). ` +
      'Binary files are refused, and so is anything that may hold a secret; values that look like credentials come back masked.',
    {
      path: z.string().min(1).max(4096).describe('An absolute path to a file or a directory'),
      maxBytes: z.number().int().min(1).max(65536).optional().describe('The most bytes of the file to return, ending on a whole line'),
    },
    (args) => withinBudget(() => readFromNode('file.read', args))
  );

  const statusRead = tool(
    'status_read',
    `Read one fixed status on ${deps.node}: unit (systemctl status of the unit in name), failed_units, containers (docker ps), disks (df -h), memory (free -m), uptime, or listening (listening TCP sockets).`,
    {
      what: z.enum(['unit', 'failed_units', 'containers', 'disks', 'memory', 'uptime', 'listening']),
      name: z.string().regex(UNIT_NAME).max(200).optional().describe('The unit name — required when what is "unit"'),
    },
    (args) => withinBudget(() => readFromNode('status.read', args))
  );

  const historyRead = tool(
    'history_read',
    "Read Cerberus's own record across EVERY node — not only this one: status moves of checks such as ok → failing (results), fix runs (runs) and earlier diagnoses (diagnoses), one line each, newest first. " +
      'Narrow it with node, check (a check key such as shadow-connector/upload_engine) and kinds. sinceMin is minutes back from now; limit defaults to 50, at most 200. ' +
      '"first seen" is Cerberus\'s first reading of a check — it says nothing about when the problem began, only how far back the record goes.',
    {
      node: z.string().min(1).max(100).optional().describe('Only this node; omit for every node'),
      check: z.string().min(1).max(300).optional().describe('Only this check key; omit for every check'),
      sinceMin: z.number().int().min(1).max(43_200).describe('Minutes back from now (at most 30 days)'),
      kinds: z.array(z.enum(['results', 'runs', 'diagnoses'])).min(1).optional().describe('Which records; omit for all three'),
      limit: z.number().int().min(1).max(200).optional().describe('The most lines to return'),
    },
    (args) =>
      withinBudget(async () => {
        try {
          const answer = await deps.historyRead({ ...args, limit: args.limit ?? DEFAULT_HISTORY_LIMIT });
          return textResult(answer === '' ? '(nothing in that window)' : answer);
        } catch (error) {
          console.error('[Cerberus] a diagnosis could not read history', { node: deps.node, error: describe(error) });
          return textResult(`History could not be read: ${describe(error)}`, true);
        }
      })
  );

  const note = tool(
    'note',
    'Record ONE finding in ONE sentence — what you found, e.g. "All 4 failed on one call — 401 from shadow-connector". The operator watches your notes appear as you work. Never use it for plans or guesses.',
    { text: plainText(300, { singleLine: true }) },
    async ({ text }) => {
      try {
        deps.note(text);
        return textResult('Noted.');
      } catch (error) {
        console.error('[Cerberus] a diagnosis note could not be filed', { node: deps.node, error: describe(error) });
        return textResult(`The note was not filed: ${describe(error)}`, true);
      }
    }
  );

  // `submitted` is set only once `deps.submit` has accepted a call. `deps.submit` awaits the summary audit, so of two calls that
  // arrive together the second finds `submitting` set and is told to wait: one conclusion is checked at a time, and only the first accepted counts.
  let submitted = false;
  let submitting = false;

  const submitDiagnosis = tool(
    DIAGNOSIS_SUBMIT_TOOL_NAME,
    'End the diagnosis. summary: one or two sentences saying what is wrong. evidence: each thing you FOUND that says so, one line each, quoting what the journal, file, status or history said — ' +
      'a line that is not ONE line of ONE answer copied character for character, with nothing of your own on it, is refused (the check\'s value and the prompt are not reads); never what you assumed, and never the absence of an error ("no entries" is not evidence); an empty list when you found nothing. proposal: the one command the operator could run on the node ' +
      '(name = the button\'s words, cmd = the exact command now, general = the same command with absolute times made relative), or null when no fix is warranted — ' +
      'a proposal needs evidence behind it, and is refused with none. A second reader then checks the summary against the evidence: state as found only what an evidence line shows, and say "suggests" or "may" for a cause you infer.',
    {
      summary: plainText(600),
      evidence: z.array(plainText(400)).max(10),
      proposal: z
        .object({
          name: plainText(60, { singleLine: true }),
          cmd: plainText(1000),
          general: plainText(1000),
        })
        .nullable(),
    },
    async ({ summary, evidence, proposal }) => {
      if (submitted) return textResult('A diagnosis was already submitted — you are done. Do not call any tool again.', true);
      if (submitting) return textResult('A submission is being checked — wait for its answer, then submit again only if it was refused.', true);
      if (proposal !== null && evidence.length === 0) {
        return textResult(
          'A proposal needs the evidence that points to it, and you listed none. If you found nothing that explains the check, submit proposal: null; otherwise list what you found and submit again.',
          true
        );
      }
      submitting = true;
      try {
        await deps.submit({ summary, evidence, proposal });
        submitted = true;
        return textResult('Diagnosis submitted. You are done — do not call any tool again.');
      } catch (error) {
        console.error('[Cerberus] a diagnosis submission was refused', { node: deps.node, error: describe(error) });
        return textResult(`The diagnosis was not accepted: ${describe(error)}. Correct it and submit again.`, true);
      } finally {
        submitting = false;
      }
    }
  );

  // The limit is put on at the one place the list leaves, so a seventh tool cannot be added without it.
  return [...(deps.linked ? [logRead, fileRead, statusRead] : []), historyRead, note, submitDiagnosis].map(keepAnswersInline);
}
