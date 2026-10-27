import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

import type { CompanionModel, CompanionProcess } from '@/shared/companion-types.js';

import type { MessageReaders } from './companion-message.js';
import type { TurnSink } from './companion-turns.js';

/**
 * Everything one account's session needs from the house, so the session reads nothing itself: the
 * account (`userId` names her working directory), her `tools` (the definitions her MCP server carries;
 * none is valid), the held CLI session id with its writer, the readers every message is assembled from
 * (`MessageReaders`) and the callbacks that tell the house what she did (`TurnSink`, `onProcess` for the
 * process's condition, `onSystemLine` for a line the panel shows in its own tone). A callback that
 * throws is logged and the conversation goes on. Consumed by `companion.service.ts`, which fills it.
 */
export type CompanionSessionDeps = MessageReaders &
  TurnSink & {
    userId: number;
    tools: Array<SdkMcpToolDefinition<any>>;
    readProviderSessionId(): string | null;
    writeProviderSessionId(id: string | null): void;
    onProcess(process: CompanionProcess): void;
    onSystemLine(text: string): void;
  };

/**
 * The surface of her conversation. The four pushes each assemble and push ONE message, start a turn
 * when she is idle and wake a closed process (`pushOperatorEmpty` is a press of the talk button that carried
 * no words she could hear: `<operator via="spoken" heard="nothing">`, still a turn she answers); `warm` starts the process of a closed one ahead of its first
 * message and pushes nothing (the CLI takes about a second to come up, which a caller that knows a push is
 * coming in seconds spends in parallel); `oweCut` stores the cut the next message opens with (the last sentence he heard to its end, and the one playing at the press);
 * `interrupt` stops her turn (her Stop, or the voice's cut); `setModel` applies a model change to a
 * running process (a closed one launches on the stored model); `clear` interrupts, closes and forgets
 * the held session id; `close` ends the input and the process. `process` is the condition the panel
 * shows and `turnId` the turn in flight (`null` when idle). Consumed by `companion.service.ts` and the voice.
 */
export type CompanionSession = {
  pushOperator(text: string, via: 'typed' | 'spoken'): void;
  pushOperatorEmpty(): void;
  pushAlerts(blocks: string[]): void;
  pushFocusNews(envelope: string): void;
  warm(): void;
  oweCut(heard: string | null, interrupted: string | null): void;
  interrupt(): Promise<void>;
  setModel(model: CompanionModel): Promise<void>;
  clear(): Promise<void>;
  close(reason: string): Promise<void>;
  readonly process: CompanionProcess;
  readonly turnId: string | null;
};
