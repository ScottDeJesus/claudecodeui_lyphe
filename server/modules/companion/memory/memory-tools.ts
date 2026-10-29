import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { guardedToolResult } from '@/shared/tool-text-result.js';

import { toolLine } from '../session/companion-prompt.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';

import { forget, recall, remember } from './memory-verbs.js';

/** The shape of a docstore token, which is what `corrects` and `memories` name. */
const TOKEN = /^(INV|MAN)-\d+$/;

/**
 * Her memory's three tools: `recall`, `remember` and `forget`, in the order her prompt lists them. Each description is her prompt's own
 * line for the tool (`toolLine`), so the tool list and the prompt cannot say two things. Only `recall` is marked read-only, as the
 * eyes' reads are: `remember` and `forget` change her bank (through her own door, `memory-verbs.ts`) and the CLI should ask nothing of
 * them either way, since the server decides what is kept. None sets an activity (`withActivity`): a read of her bank runs as `thinking`,
 * as an eyes read does, so her state machine stays as it is. Every handler runs inside `guardedToolResult`, so a failure is a sentence
 * to her and never a stack. Consumed by `tools/companion-tools.ts` (`buildCompanionTools`), once per account.
 */
export function memoryTools(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'recall',
      toolLine('recall'),
      {
        about: z.string().trim().min(1).max(500).describe("What you want to know about, in a phrase, or one memory's token (such as INV-12) to read it whole."),
        panel: z
          .boolean()
          .optional()
          .describe('true puts the whole answer on his panel as a note and tells you only that it is there; the answer never enters your context. Leave out to read it yourself.'),
      },
      (args) => guardedToolResult('recall', 'read your memory', () => recall(deps, args)),
      { annotations: { readOnlyHint: true } }
    ),
    tool(
      'remember',
      toolLine('remember'),
      {
        kind: z.enum(['rule', 'gotcha', 'landmine', 'manual']).describe('rule: how he wants things done. gotcha: a trap he named. landmine: something that will hurt if forgotten. manual: a name, a how-to or a fact he gave.'),
        title: z.string().trim().min(1).max(40).describe('A few words you can say aloud, such as "Brief length".'),
        said: z.array(z.string().trim().min(1).max(2000)).min(1).max(6).describe('The lines he said that carry it, each exactly as he said it. Only lines he spoke are kept; a typed line is refused.'),
        why: z.enum(['asked', 'ruling', 'name', 'stale', 'brief']).describe('asked: he told you to keep it. Else your own judgment: ruling (a standing ruling or preference), name (a name he gives something), stale (something he told you is stale) or brief (how he likes a brief written).'),
        context: z.string().trim().min(1).max(300).optional().describe('One line of yours for what "this" or "that" meant in his words. Leave out when his words stand alone.'),
        corrects: z.string().trim().regex(TOKEN).optional().describe('The token of the memory this one corrects; it is rewritten. Leave out for a new memory.'),
        also: z.boolean().optional().describe('true keeps this beside a memory about the same thing. Never together with corrects.'),
      },
      (args) => guardedToolResult('remember', 'keep that', () => remember(deps, args))
    ),
    tool(
      'forget',
      toolLine('forget'),
      {
        memories: z.array(z.string().trim().regex(TOKEN)).min(1).max(5).describe('The tokens of the memories to stop keeping, one to five.'),
        said: z.string().trim().min(1).max(2000).describe('His line that tells you to forget them, exactly as he said it. Each forget needs a new line of his.'),
      },
      (args) => guardedToolResult('forget', 'forget that', () => forget(deps, args))
    ),
  ];
}
