import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { isRecord } from '@/shared/document-fields.js';
import { guardedToolResult } from '@/shared/tool-text-result.js';

import { toolLine } from '../session/companion-prompt.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';

import { readHeal } from './heal-reads.js';
import { readKanban } from './kanban-reads.js';
import { readNotes } from './notes-reads.js';
import { readSchedules } from './schedule-reads.js';

/**
 * Her eyes on four of his panels: `read_kanban` (the Kanban board), `read_heal` (the heal list, the house's friction),
 * `read_notes` (his notes) and `read_schedules` (the schedules). Each reads through the reader its own panel uses, never a
 * second copy of the data:
 *   - the board: `kanbanBoardsService` and `kanbanCardsService` (`kanban-reads.ts`);
 *   - the heal list: `deps.house.heal`, the heal lane's service (`heal-reads.ts`);
 *   - his notes: `notesService` (`notes-reads.ts`);
 *   - the schedules: `readRegistry` (`schedule-reads.ts`).
 *
 * EVERY READ TAKES A SCOPE and answers small: a list is one line per item and capped (`cappedLines`), and an answer past 2,000
 * characters is handed to a dactyl under the scope's fixed brief (`wholeOrDigest`), so none of the house is in her context until
 * she looks. `panel: true` puts the whole answer on his panel as a note and tells her only that it is there. NO EYES TOOL MOVES
 * HER FOCUS OR HER ACTIVITY: a read runs as `thinking`, so none of them calls `setFocus` or `withActivity`. NEVER SPEND
 * (ruling 1): no renderer here reads a cost, a token count or a cap.
 *
 * All four are marked read-only: they change nothing of his and the CLI never asks about them. Each description is her prompt's
 * own line for the tool (`toolLine`). Consumed by `tools/companion-tools.ts` (`buildCompanionTools`), once per account.
 */

/** The longest scope or board name she may pass: a limit of the tools' schemas, the one `read_session` holds its scope to. */
const SCOPE_MAX = 200;

/** `panel`, the field every eyes tool takes. */
const PANEL_FIELD = z
  .boolean()
  .optional()
  .describe('true puts the whole answer on his panel as a note and tells you only that it is there; the answer never enters your context. Leave out to read it yourself.');

/** The call's own AbortSignal, when the SDK hands one in the handler's second argument (it does for a tool call that is cancelled, as when she is stopped). */
function signalOf(extra: unknown): AbortSignal | undefined {
  const signal = isRecord(extra) ? extra.signal : undefined;
  return signal instanceof AbortSignal ? signal : undefined;
}

/** The definitions of `read_kanban`, `read_heal`, `read_notes` and `read_schedules` (the order her prompt lists them). */
export function panelReads(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  const readOnly = { annotations: { readOnlyHint: true } };
  return [
    tool(
      'read_kanban',
      toolLine('read_kanban'),
      {
        scope: z
          .string()
          .trim()
          .min(1)
          .max(SCOPE_MAX)
          .describe(
            'board: every lane with its count, then a few cards each of questions, active and todo. A lane by its name: not ready, todo, questions, active or done. Or one card by its id (such as c-588) or its title, or a phrase over titles and tags.'
          ),
        board: z.string().trim().max(SCOPE_MAX).optional().describe("A board's name or id. Leave out for the board with the most cards not done."),
        panel: PANEL_FIELD,
      },
      (args, extra) => guardedToolResult('read_kanban', 'read the Kanban board', () => readKanban(deps, args, signalOf(extra))),
      readOnly
    ),
    tool(
      'read_heal',
      toolLine('read_heal'),
      {
        scope: z
          .string()
          .trim()
          .min(1)
          .max(SCOPE_MAX)
          .describe('summary: how much friction is live, the biggest kinds and the heals open now. cycles: the newest five cycles. Or one friction kind, such as tool-error, for its rows.'),
        panel: PANEL_FIELD,
      },
      (args, extra) => guardedToolResult('read_heal', 'read the heal list', () => readHeal(deps, args, signalOf(extra))),
      readOnly
    ),
    tool(
      'read_notes',
      toolLine('read_notes'),
      {
        scope: z
          .string()
          .trim()
          .min(1)
          .max(SCOPE_MAX)
          .describe('list: every note, newest first, one line each. Or one note by its title or id, or a phrase over titles and text.'),
        panel: PANEL_FIELD,
      },
      (args, extra) => guardedToolResult('read_notes', 'read his notes', () => readNotes(deps, args, signalOf(extra))),
      readOnly
    ),
    tool(
      'read_schedules',
      toolLine('read_schedules'),
      {
        scope: z
          .string()
          .trim()
          .min(1)
          .max(SCOPE_MAX)
          .describe('list: every scheduled job, one line each. drift: the jobs that no longer agree with the box. Or one job by its name, or a phrase over names, purposes and commands.'),
        panel: PANEL_FIELD,
      },
      (args, extra) => guardedToolResult('read_schedules', 'read the schedules', () => readSchedules(deps, args, signalOf(extra))),
      readOnly
    ),
  ];
}
