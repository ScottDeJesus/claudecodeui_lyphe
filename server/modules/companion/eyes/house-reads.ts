import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { getMemoryCandidate, listMemoryCandidates } from '@/modules/memory-intake/index.js';
import { geminiKeyStatus, readVoiceSettings } from '@/modules/voice/index.js';
import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import { modelOptions } from '../companion-picture.js';
import { readCompanionSettings } from '../companion-settings.js';
import { COMPANION_REGISTER_DEFAULT, toolLine } from '../session/companion-prompt.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';
import { chatNameOf } from '../tools/house-reads.js';
import { signalOf } from '../tools/read-tools.js';

import { checkText, findChecks, findNode, foundLines, needsLines, nodeText, overviewText, withoutUsageChecks } from './cerberus-lines.js';
import { LIST_ABOUT_NOTHING, NOTE_ABOUT_NOTHING } from './card-shapes.js';
import { answerRead, cappedLines, wholeOrDigest } from './eyes-answer.js';
import { readGit } from './git-reads.js';
import { counted } from './line-words.js';
import { pendingLine, proposalHolds, proposalIdOf, proposalText, reviewedLine, reviewedRecently, sourceWords } from './memory-lines.js';
import { companionSettingsLines, voiceSettingsLines } from './settings-lines.js';

/**
 * Her eyes on the rest of the house: `read_git` (a project's uncommitted work, `git-reads.ts`), `read_cerberus` (the Cerberus
 * tab's overview), `read_memory` (the memory proposals sessions made) and `read_settings` (her own settings and the voice's).
 * Each reads through the reader its panel uses, never a second copy: the git panel's `readGitStatus` and `readGitFileDiff`,
 * `house.cerberus()` (the tab's own overview), `listMemoryCandidates` and `getMemoryCandidate` (memory intake's barrel),
 * `readCompanionSettings` and the voice barrel's `readVoiceSettings` and `geminiKeyStatus`.
 *
 * EVERY READ TAKES A SCOPE and answers small: a list is one line per item and capped (`cappedLines`), and an answer past 2,000
 * characters is handed to a dactyl under the scope's fixed brief (`answerRead`). `panel: true` puts the whole answer on his panel
 * as a note. NO EYES TOOL MOVES HER FOCUS OR HER ACTIVITY: a read runs as `thinking`, so none of these calls `setFocus` or
 * `withActivity`. NOTHING IS EVER WRITTEN to his settings, and `read_settings` says a Gemini key by whose it is, never the key.
 * NEVER SPEND (ruling 1): no renderer here reads a cost, a token count, a cap or a pacer window, and `read_cerberus` drops the
 * usage family of checks (a vendor's spend or usage, whose value is money) from every list before a scope is read.
 *
 * All four are marked read-only. Each description is her prompt's own line for the tool (`toolLine`). Consumed by
 * `tools/companion-tools.ts` (`buildCompanionTools`), once per account.
 */

/** The longest scope she may pass, and the longest project name: limits of the schemas, the one `read_session` holds its scope to. */
const SCOPE_MAX = 200;
const PROJECT_MAX = 300;

/** The most proposals a list names; and how many of each status `recent` and a phrase look through. */
const MEMORY_LIST_MAX = 15;
const MEMORY_SCAN_LIMIT = 500;

/** What a dactyl is asked of a long answer, per scope. (`NO_SPEND` is added by `wholeOrDigest`.) */
const OVERVIEW_BRIEF = 'What is the state of this fleet, and which checks need him most? At most 10 lines; cite L<n>.';
const NEEDS_BRIEF = 'Which checks need him, how bad is each, and what does each say is wrong? At most 12 lines; cite L<n>.';
const NODE_BRIEF = 'What state is this node in: which services and checks are failing, close to the limit or muted, and why? At most 12 lines; cite L<n>.';
const CHECK_BRIEF = 'What does this check say, and for how long has it said it? At most 6 lines; cite L<n>.';
const MEMORY_LIST_BRIEF = 'List the proposals, one line each, keeping each id. At most 15 lines; cite L<n>.';
const PROPOSAL_BRIEF = 'What does this memory propose to remember, where would it go, and why? At most 8 lines; cite L<n>.';
const SETTINGS_BRIEF = 'What are these settings? At most 8 lines; cite L<n>.';

/** `panel`, the field every eyes tool but `read_settings` takes. */
const PANEL_FIELD = z
  .boolean()
  .optional()
  .describe('true puts the whole answer on his panel as a card and tells you only that it is there; the answer never enters your context. Leave out to read it yourself.');

type Args = { scope: string; panel?: boolean };

/** `read_cerberus`: the overview, what needs him, a node, a check, or a phrase over the checks. */
function readCerberus(deps: CompanionToolDeps, args: Args, signal: AbortSignal | undefined): Promise<ToolTextResult> | ToolTextResult {
  // The usage family is taken out before any scope reads (ruling 1): a spend check's value is money, and no list may print it.
  const overview = withoutUsageChecks(deps.house.cerberus());
  const scope = args.scope.trim();
  const panel = args.panel === true;
  const answer = (title: string, text: string, label: string, brief: string, intro = '') =>
    answerRead(deps, { panel, title: `Cerberus: ${title}`, text, label, brief, intro, shape: LIST_ABOUT_NOTHING }, signal);

  if (scope.toLowerCase() === 'overview') return answer('overview', overviewText(overview), 'cerberus-overview', OVERVIEW_BRIEF);
  if (scope.toLowerCase() === 'needs') {
    const lines = needsLines(overview);
    return lines.length === 0 ? textResult('Nothing needs him in Cerberus.') : answer('what needs him', lines.join('\n'), 'cerberus-needs', NEEDS_BRIEF, `${lines.length} need him, worst first:`);
  }
  const node = findNode(overview, scope);
  if (node !== null) return answer(node.id, nodeText(node), 'cerberus-node', NODE_BRIEF);

  const found = findChecks(overview, scope);
  if (found.length === 1) return answer(scope, checkText(found[0]), 'cerberus-check', CHECK_BRIEF);
  if (found.length > 1) {
    return answer(`checks holding "${scope}"`, cappedLines(foundLines(found)), 'cerberus-checks', NEEDS_BRIEF, `${found.length} checks hold "${scope}"; scope <node>/<service>/<check> reads one:`);
  }
  const nodes = overview.nodes.map((candidate) => candidate.id).join(', ');
  const known = nodes === '' ? 'It reports no nodes' : `Its nodes are ${nodes}`;
  return deps.refuse(`Cerberus has no node or check that fits "${scope}". ${known}; scope overview says what needs him, and a phrase searches the checks.`);
}

/** The name of the chat that proposed a memory, or `null` when the proposal recorded none. */
const proposedBy = (sessionId: string | null): string | null => (sessionId === null ? null : chatNameOf(sessionId));

/** `read_memory`: the proposals waiting, the ones reviewed lately with their verdict, one whole by its id, or a phrase over them. */
function readMemory(deps: CompanionToolDeps, args: Args, signal: AbortSignal | undefined): Promise<ToolTextResult> | ToolTextResult {
  const scope = args.scope.trim();
  const panel = args.panel === true;
  const list = (title: string, lines: string[], intro: string) =>
    answerRead(deps, { panel, title: `Memory: ${title}`, text: cappedLines(lines, MEMORY_LIST_MAX), label: 'memory-list', brief: MEMORY_LIST_BRIEF, intro, shape: LIST_ABOUT_NOTHING }, signal);

  if (scope.toLowerCase() === 'pending') {
    const waiting = listMemoryCandidates({ status: 'pending', limit: MEMORY_SCAN_LIMIT });
    if (waiting.length === 0) return textResult('No memory proposals are waiting for him.');
    return list('proposals waiting', waiting.map((candidate) => pendingLine(candidate, sourceWords(proposedBy(candidate.sessionId)))), `${counted(waiting.length, 'proposal')} waiting, newest first:`);
  }
  if (scope.toLowerCase() === 'recent') {
    const reviewed = [...listMemoryCandidates({ status: 'approved', limit: MEMORY_SCAN_LIMIT }), ...listMemoryCandidates({ status: 'rejected', limit: MEMORY_SCAN_LIMIT })]
      .filter((candidate) => reviewedRecently(candidate))
      .sort((a, b) => Date.parse(b.reviewedAt ?? '') - Date.parse(a.reviewedAt ?? ''));
    if (reviewed.length === 0) return textResult('He has reviewed no memory proposal in the last 7 days.');
    return list('reviewed lately', reviewed.map(reviewedLine), `${counted(reviewed.length, 'proposal')} reviewed in the last 7 days, newest first:`);
  }
  const id = proposalIdOf(scope);
  if (id !== null) {
    const candidate = getMemoryCandidate(id);
    if (candidate === null) return deps.refuse(`No memory proposal has the id ${id}. Scope pending lists the ones waiting.`);
    const text = proposalText(candidate, sourceWords(proposedBy(candidate.sessionId)));
    return answerRead(deps, { panel, title: `Memory: ${candidate.name}`, text, label: 'memory-proposal', brief: PROPOSAL_BRIEF, intro: '', shape: NOTE_ABOUT_NOTHING }, signal);
  }
  const holding = listMemoryCandidates({ limit: MEMORY_SCAN_LIMIT }).filter((candidate) => proposalHolds(candidate, scope));
  if (holding.length === 0) return textResult(`No memory proposal holds "${scope}" in its id, title, target or project.`);
  const lines = holding.map((candidate) => (candidate.status === 'pending' ? pendingLine(candidate, sourceWords(proposedBy(candidate.sessionId))) : reviewedLine(candidate)));
  return list(`proposals holding "${scope}"`, lines, `${counted(holding.length, 'proposal')} hold "${scope}":`);
}

/** `read_settings`: her own settings, or the voice's. Reads only; nothing is ever written to his settings. */
async function readSettings(deps: CompanionToolDeps, args: { scope: string }, signal: AbortSignal | undefined): Promise<ToolTextResult> {
  const scope = args.scope.trim().toLowerCase();
  let lines: string[];
  if (scope === 'companion') {
    const settings = readCompanionSettings(deps.userId);
    const label = (await modelOptions()).find((option) => option.value === settings.model)?.label ?? settings.model;
    lines = companionSettingsLines(settings, label, COMPANION_REGISTER_DEFAULT);
  } else if (scope === 'voice') {
    // Only the key's `source` leaves this call: its last characters are not read.
    lines = voiceSettingsLines(readVoiceSettings(deps.userId), geminiKeyStatus(deps.userId).source);
  } else {
    return deps.refuse('read_settings reads companion (your own settings) or voice (the chat mic and your voice). Pass one of them as scope.');
  }
  return wholeOrDigest(deps, { text: lines.join('\n'), label: `settings-${scope}`, brief: SETTINGS_BRIEF, intro: '' }, signal);
}

/**
 * The definitions of `read_git`, `read_cerberus`, `read_memory` and `read_settings` (the order her prompt lists them), built
 * with the SDK's `tool()` and zod. All four are marked read-only: they change nothing of his and the CLI never asks about
 * them. Consumed by `tools/companion-tools.ts` (`buildCompanionTools`), once per account.
 */
export function houseReads(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  const readOnly = { annotations: { readOnlyHint: true } };
  return [
    tool(
      'read_git',
      toolLine('read_git'),
      {
        project: z.string().trim().min(1).max(PROJECT_MAX).describe('The project, by its display name or its path, as list_projects shows it.'),
        scope: z
          .string()
          .trim()
          .min(1)
          .max(SCOPE_MAX)
          .describe("status: start here, the branch and the changed files. diff: every changed file's diff as a digest, which takes a while. Or one changed file by its path, or the end of it: its diff. A file whose name marks it a secret is named and never read."),
        panel: PANEL_FIELD,
      },
      (args, extra) => guardedToolResult('read_git', 'read the uncommitted work', () => readGit(deps, args, signalOf(extra))),
      readOnly
    ),
    tool(
      'read_cerberus',
      toolLine('read_cerberus'),
      {
        scope: z
          .string()
          .trim()
          .min(1)
          .max(SCOPE_MAX)
          .describe('overview: start here, the counts, the ten that need him most and any node not reporting. needs: all of what needs him, as a digest. A node by its id: its services. A check as node/service/check: its reading. Or a phrase over the checks.'),
        panel: PANEL_FIELD,
      },
      (args, extra) => guardedToolResult('read_cerberus', 'read the Cerberus overview', () => readCerberus(deps, args, signalOf(extra))),
      readOnly
    ),
    tool(
      'read_memory',
      toolLine('read_memory'),
      {
        scope: z
          .string()
          .trim()
          .min(1)
          .max(SCOPE_MAX)
          .describe('pending: the proposals waiting for him. recent: those he reviewed in the last 7 days, with the verdict. One proposal by its id (such as mc-136): the whole of it. Or a phrase over ids, titles, targets and projects.'),
        panel: PANEL_FIELD,
      },
      (args, extra) => guardedToolResult('read_memory', 'read the memory proposals', () => readMemory(deps, args, signalOf(extra))),
      readOnly
    ),
    tool(
      'read_settings',
      toolLine('read_settings'),
      {
        scope: z.string().trim().min(1).max(SCOPE_MAX).describe("companion: your own settings (names, model, Live, delivery note, talk button, register). voice: the chat mic and your voice (models, voice, sounds, and whose Gemini key is in use, never the key)."),
      },
      (args, extra) => guardedToolResult('read_settings', 'read the settings', () => readSettings(deps, args, signalOf(extra))),
      readOnly
    ),
  ];
}
