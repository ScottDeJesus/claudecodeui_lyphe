/**
 * Message normalization utilities.
 * Converts NormalizedMessage[] from the session store into ChatMessage[] for the UI.
 */

import type { ChatMessage,NormalizedMessage,SubagentActivity, SubagentUsage } from '@/shared/types';
import { formatUsageLimitText } from '@/modules/chat/utils/chatFormatting';

function formatToolResultContent(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const toolUseErrorMatch = /^<tool_use_error>([\s\S]*)<\/tool_use_error>$/.exec(text.trim());
  return toolUseErrorMatch ? toolUseErrorMatch[1] : text;
}

type ParsedTaskNotification = {
  status: string;
  summary: string;
  result: string;
};

type ToolResultSource = NormalizedMessage['toolResult'] | NormalizedMessage | null;

/**
 * The live fold of one agent's usage: its newest context reading and the ids of the API
 * messages seen. No reply count — a live row's usage is the snapshot taken when the row was cut,
 * a few tokens into the reply (measured 2026-09-10: 69 "written" live against 3,298 on the
 * transcript for the same run), and a figure that wrong is worse than none. The transcript's
 * reading, which has the whole reply, arrives with the next history load.
 */
type LiveUsageFold = { contextTokens: number; messageIds: Set<string> };

const readLiveUsage = (fold: LiveUsageFold | undefined): SubagentUsage | undefined => (
  fold && fold.messageIds.size > 0
    ? { contextTokens: fold.contextTokens, outputTokens: 0, requests: fold.messageIds.size }
    : undefined
);

/**
 * One reading from up to three: the server's (the whole transcript as of the history load, and
 * the only one that knows what the agent wrote), the live fold's (what this page has seen since),
 * and the CLI's exact total at finish. Context is monotonic within a run (verified on 23 real
 * transcripts) and so is the request count, so the largest of each is the newest, and the reply
 * total is the server's or nothing. Never a CHOICE between them: choosing by request count froze
 * the figure at its page-load value while the server was ahead, hid the written total once the
 * live fold was, and threw the exact total away at finish (Athena, 2026-09-10).
 */
const combineSubagentUsage = (
  server: SubagentUsage | undefined,
  live: SubagentUsage | undefined,
  finishedContextTokens: number | undefined,
): SubagentUsage | undefined => {
  if (!server && !live && !finishedContextTokens) {
    return undefined;
  }
  return {
    contextTokens: Math.max(server?.contextTokens ?? 0, live?.contextTokens ?? 0, finishedContextTokens ?? 0),
    outputTokens: server?.outputTokens ?? 0,
    requests: Math.max(server?.requests ?? 0, live?.requests ?? 0),
  };
};

/**
 * The CLI's own total for a finished agent, its context as of its last request. The live fold
 * stops one request short of it (the closing reply never streams as a subagent row), so without
 * this the finished figure lagged the terminal's until a reload.
 *
 * Two sources, in this order. `totalTokens` on the `Agent` tool's result is exact. `tokens` on
 * the live finish row is the notification's count, which the CLI takes before the closing
 * reply's own request is in — one request short, every time (measured 2026-09-10: 39,735
 * against the result's 39,913; 21,751 against 21,997). A foreground agent has both, and the
 * result wins; a backgrounded one has only the notification, its launch receipt carrying no
 * total at all.
 */
const readFinishedContextTokens = (toolResult: ToolResultSource, finish: NormalizedMessage | null): number | undefined => {
  const fromResult = Number((toolResult as { toolUseResult?: { totalTokens?: unknown } } | null)?.toolUseResult?.totalTokens);
  const fromNotification = Number(finish?.tokens);
  const total = Number.isFinite(fromResult) && fromResult > 0 ? fromResult : fromNotification;
  return Number.isFinite(total) && total > 0 ? total : undefined;
};

type CachedMessageProjection = {
  /** A tool-use row also depends on a separately received tool-result row. */
  toolResultSource: ToolResultSource;
  /** A live subagent container also depends on the newest row folded into its timeline. */
  subagentActivitySource: NormalizedMessage | null;
  /** …and on the `<task-notification>` turn that declares its background agent finished. */
  finishSource: NormalizedMessage | null;
  messages: ChatMessage[];
};

// Normalized messages are immutable store records. Reuse the UI objects made
// from records that survived a store update so memoized message rows can skip
// work while only the active streaming record changes. Weak keys let entries
// disappear automatically after their source records are no longer retained.
const projectionCache = new WeakMap<NormalizedMessage, CachedMessageProjection>();

/**
 * Parses a background-agent `<task-notification>` block.
 *
 * The harness injects these as user-role messages when a background task stops.
 * Newer notifications carry extra fields (`<tool-use-id>`, `<note>`, `<usage>`,
 * and a `<result>` markdown payload) that the previous single-shot regex could
 * not match, so the whole raw XML block leaked through as plain user text.
 * Fields are extracted independently so the block renders as an assistant
 * notification plus, when present, the agent's markdown result.
 */
function parseTaskNotification(content: string): ParsedTaskNotification | null {
  if (!content.trimStart().startsWith('<task-notification>')) {
    return null;
  }

  const statusMatch = /<status>([\s\S]*?)<\/status>/.exec(content);
  const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(content);

  let result = '';
  const resultOpen = content.indexOf('<result>');
  if (resultOpen !== -1) {
    const afterOpen = content.slice(resultOpen + '<result>'.length);
    const closeIndex = afterOpen.indexOf('</result>');
    result =
      closeIndex === -1
        ? afterOpen.replace(/<\/task-notification>\s*$/, '').trim()
        : afterOpen.slice(0, closeIndex).trim();
  }

  return {
    status: statusMatch?.[1]?.trim() || 'completed',
    summary: summaryMatch?.[1]?.trim() || 'Background task finished',
    result,
  };
}

/**
 * Convert NormalizedMessage[] from the session store into ChatMessage[]
 * that the existing UI components expect.
 *
 * Truly internal/system content is already filtered server-side. Some Claude
 * transcript artifacts such as local slash commands and compact summaries are
 * intentionally preserved and annotated so they can render like normal chat.
 */
export function normalizedToChatMessages(messages: NormalizedMessage[]): ChatMessage[] {
  const converted: ChatMessage[] = [];

  // First pass: collect tool results for attachment, and fold live subagent
  // rows into their spawning tool call's timeline. A running subagent's rows
  // stream in stamped with `parentToolUseId`; rendered top-level they read as
  // the session's own tool calls, only to jump inside the container on the
  // next history load, which ships the same timeline as `subagentTools`.
  const toolResultMap = new Map<string, NormalizedMessage>();
  const toolUseIds = new Set<string>();
  const liveSubagentActivity = new Map<string, SubagentActivity[]>();
  const liveSubagentToolsById = new Map<string, SubagentActivity>();
  /** What each live agent has spent so far, by container (see `LiveUsageFold`). */
  const liveSubagentUsage = new Map<string, LiveUsageFold>();
  /** Newest folded row per container, so its cached projection knows to rebuild. */
  const lastSubagentSourceByParent = new Map<string, NormalizedMessage>();
  /**
   * The row that finished each background agent, by the `Agent` call it names. On a history
   * load the server folds the transcript's `<task-notification>` turn onto the container
   * (`subagent.status`, the finish time). On the LIVE path that turn never streams; the
   * runtime provider forwards the SDK's `task_notification` event as a `task_notification`
   * row carrying `toolId`, and without this fold a finished agent stayed "running" — and
   * pinned above the transcript — until the next reload.
   */
  const finishByToolUseId = new Map<string, { status: string; source: NormalizedMessage }>();
  for (const msg of messages) {
    if (msg.kind === 'task_notification' && msg.toolId) {
      finishByToolUseId.set(msg.toolId, { status: typeof msg.status === 'string' ? msg.status : 'completed', source: msg });
    }
    if (msg.parentToolUseId) {
      const parentId = msg.parentToolUseId;
      let activity = liveSubagentActivity.get(parentId);
      if (!activity) {
        activity = [];
        liveSubagentActivity.set(parentId, activity);
      }

      if (msg.usage && msg.usageMessageId) {
        let fold = liveSubagentUsage.get(parentId);
        if (!fold) {
          fold = { contextTokens: 0, messageIds: new Set() };
          liveSubagentUsage.set(parentId, fold);
        }
        fold.contextTokens = msg.usage.contextTokens;
        fold.messageIds.add(msg.usageMessageId);
        // A figure that moved is a reason to redraw the container, whatever the row said.
        lastSubagentSourceByParent.set(parentId, msg);
      }

      switch (msg.kind) {
        case 'tool_use': {
          const tool: SubagentActivity = {
            kind: 'tool',
            toolId: msg.toolId,
            toolName: msg.toolName || 'Tool',
            toolInput: msg.toolInput,
            timestamp: msg.timestamp,
          };
          activity.push(tool);
          if (msg.toolId) {
            liveSubagentToolsById.set(msg.toolId, tool);
          }
          lastSubagentSourceByParent.set(parentId, msg);
          break;
        }
        case 'tool_result': {
          const tool = msg.toolId ? liveSubagentToolsById.get(msg.toolId) : undefined;
          if (tool) {
            tool.toolResult = {
              content: formatToolResultContent(msg.content ?? ''),
              isError: Boolean(msg.isError),
            };
            lastSubagentSourceByParent.set(parentId, msg);
          }
          break;
        }
        case 'text':
        case 'thinking': {
          // Assistant prose and reasoning only, matching the timeline the
          // server builds from the subagent's transcript — user-role rows
          // there are tool results and the echoed task prompt.
          if ((msg.kind === 'thinking' || msg.role === 'assistant') && msg.content?.trim()) {
            activity.push({
              kind: msg.kind === 'thinking' ? 'thinking' : 'text',
              content: msg.content,
              timestamp: msg.timestamp,
            });
            lastSubagentSourceByParent.set(parentId, msg);
          }
          break;
        }
        default:
          break;
      }
      continue;
    }

    if (msg.kind === 'tool_use' && msg.toolId) {
      toolUseIds.add(msg.toolId);
    }

    if (msg.kind === 'tool_result' && msg.toolId) {
      toolResultMap.set(msg.toolId, msg);
    }
  }

  for (const msg of messages) {
    // Subagent rows were folded into their container's timeline above.
    if (msg.parentToolUseId) {
      continue;
    }

    const toolResultSource: ToolResultSource = msg.kind === 'tool_use'
      ? msg.toolResult || (msg.toolId ? toolResultMap.get(msg.toolId) : null) || null
      : null;
    const subagentActivitySource = msg.kind === 'tool_use' && msg.toolId
      ? lastSubagentSourceByParent.get(msg.toolId) ?? null
      : null;
    const finish = msg.kind === 'tool_use' && msg.toolId ? finishByToolUseId.get(msg.toolId) : undefined;
    const finishSource = finish?.source ?? null;
    const cachedProjection = projectionCache.get(msg);

    // A tool-use projection must be rebuilt when a matching result arrives,
    // even though the original tool-use record itself is unchanged. The same
    // holds for a subagent container when its live timeline grows, and when
    // the notification that finishes its agent lands.
    if (
      cachedProjection?.toolResultSource === toolResultSource
      && cachedProjection.subagentActivitySource === subagentActivitySource
      && cachedProjection.finishSource === finishSource
    ) {
      converted.push(...cachedProjection.messages);
      continue;
    }

    const convertedStart = converted.length;
    const sharedMetadata = {
      displayText: msg.displayText,
      commandName: msg.commandName,
      commandMessage: msg.commandMessage,
      commandArgs: msg.commandArgs,
      isLocalCommand: msg.isLocalCommand,
      isLocalCommandStdout: msg.isLocalCommandStdout,
      isCompactSummary: msg.isCompactSummary,
      // Carried through so a rendered user bubble can address its own
      // transcript row when the user edits or forks from it.
      transcriptAnchorId: msg.transcriptAnchorId,
      // Which model produced the row. Shared rather than picked per branch
      // because a turn reaches the screen as a RUN of rows — thinking, tool
      // calls, then the reply — and the caption is drawn by whichever comes
      // first. Naming only the reply captions every working turn "Claude".
      model: msg.model,
    };

    switch (msg.kind) {
      case 'text': {
        const content = msg.content || '';
        const images = Array.isArray(msg.images) && msg.images.length > 0 ? msg.images : undefined;
        const files = Array.isArray(msg.files) && msg.files.length > 0 ? msg.files : undefined;
        if (!content.trim() && !images && !files) break;

        if (msg.role === 'user') {
          // Parse task notifications
          const taskNotif = parseTaskNotification(content);
          if (taskNotif) {
            converted.push({
              type: 'assistant',
              content: taskNotif.summary,
              timestamp: msg.timestamp,
              isTaskNotification: true,
              taskStatus: taskNotif.status,
              ...sharedMetadata,
            });
            // Render the agent's result as a normal assistant message so its
            // markdown displays correctly instead of leaking raw XML.
            if (taskNotif.result) {
              converted.push({
                type: 'assistant',
                content: formatUsageLimitText(taskNotif.result),
                timestamp: msg.timestamp,
                isTaskResult: true,
                ...sharedMetadata,
              });
            }
          } else {
            converted.push({
              type: 'user',
              content,
              timestamp: msg.timestamp,
              images,
              files,
              ...sharedMetadata,
            });
          }
        } else {
          const text = formatUsageLimitText(content);
          converted.push({
            type: 'assistant',
            content: text,
            timestamp: msg.timestamp,
            memoryCitations: msg.memoryCitations,
            ...sharedMetadata,
          });
        }
        break;
      }

      case 'tool_use': {
        const tr = toolResultSource;
        // A row is a subagent container when the backend attached agent
        // metadata to it. Both providers normalize to that, so no provider or
        // tool-name special-casing is needed here; the name check only covers
        // a live spawn whose metadata has not been indexed yet.
        const isSubagentContainer = Boolean(msg.subagent)
          || msg.toolName === 'Task'
          || msg.toolName === 'Agent';

        const toolResult = tr
          ? {
              content: formatToolResultContent(tr.content),
              isError: Boolean(tr.isError),
              toolUseResult: (tr as any).toolUseResult,
            }
          : null;

        // The server-indexed timeline arrives on a history load; the live fold
        // covers the run in progress. A mid-run refresh can attach a partial
        // server timeline while newer live rows keep streaming, so the longer
        // list is the fresher one.
        const serverActivity = Array.isArray(msg.subagentTools) ? msg.subagentTools : undefined;
        const liveActivity = msg.toolId ? liveSubagentActivity.get(msg.toolId) : undefined;
        const subagentActivity = liveActivity && liveActivity.length > (serverActivity?.length ?? 0)
          ? liveActivity
          : serverActivity;

        // What the agent has spent, from every reading there is (`combineSubagentUsage`).
        const subagentUsage = isSubagentContainer
          ? combineSubagentUsage(
            msg.subagent?.usage,
            msg.toolId ? readLiveUsage(liveSubagentUsage.get(msg.toolId)) : undefined,
            readFinishedContextTokens(tr, finish?.source ?? null),
          )
          : undefined;

        // A live finish: the row names the agent's status and, being the event that ended the
        // run, the honest finish time — the receipt's own stamp is the LAUNCH. Only on the
        // container itself: a resumed agent notifies under the `SendMessage` call that resumed
        // it, and that row is not the agent.
        const launchReceipt = tr as { toolUseResult?: { agentId?: unknown } } | null;
        const finishedHere = finish && isSubagentContainer ? finish : undefined;
        const subagent = finishedHere
          ? {
              ...(msg.subagent ?? { id: String(launchReceipt?.toolUseResult?.agentId ?? msg.toolId ?? '') }),
              status: finishedHere.status === 'completed'
                ? ('completed' as const)
                : finishedHere.status === 'stopped'
                  ? ('stopped' as const)
                  : ('failed' as const),
            }
          : msg.subagent;

        converted.push({
          type: 'assistant',
          content: '',
          timestamp: msg.timestamp,
          isToolUse: true,
          toolName: msg.toolName,
          toolInput: typeof msg.toolInput === 'string' ? msg.toolInput : JSON.stringify(msg.toolInput ?? '', null, 2),
          toolId: msg.toolId,
          toolResult,
          // When the result landed — the finish time for a subagent container. The agent's own
          // last activity is not: the stored timeline is truncated from the HEAD at 200 entries,
          // and it stops before the closing reply that ends the run.
          // Only the separately-delivered result row carries a time; a result attached inline
          // to the tool call has none, and no stamp is better than the call's own start time.
          toolResultAt: finishedHere ? finishedHere.source.timestamp : (tr && 'timestamp' in tr ? tr.timestamp : undefined),
          toolStatus: typeof msg.status === 'string' ? msg.status : undefined,
          isSubagentContainer,
          subagent,
          subagentActivity,
          subagentUsage,
          memoryCitations: msg.memoryCitations,
          ...sharedMetadata,
        });
        break;
      }

      case 'thinking':
        if (msg.content?.trim()) {
          converted.push({
            type: 'assistant',
            content: msg.content,
            timestamp: msg.timestamp,
            isThinking: true,
            ...sharedMetadata,
          });
        }
        break;

      case 'error':
        converted.push({
          type: 'error',
          content: msg.content || 'Unknown error',
          timestamp: msg.timestamp,
          ...sharedMetadata,
        });
        break;

      case 'task_notification':
        converted.push({
          type: 'assistant',
          content: msg.summary || 'Background task update',
          timestamp: msg.timestamp,
          isTaskNotification: true,
          taskStatus: msg.status || 'completed',
          ...sharedMetadata,
        });
        break;

      case 'stream_delta':
        if (msg.content) {
          converted.push({
            type: 'assistant',
            content: msg.content,
            timestamp: msg.timestamp,
            isStreaming: true,
            ...sharedMetadata,
          });
        }
        break;

      // stream_end, complete, status, permission_*, session_created
      // are control events — not rendered as messages
      case 'stream_end':
      case 'complete':
      case 'status':
      case 'permission_request':
      case 'permission_resolved':
      case 'permission_cancelled':
      case 'session_created':
        // Skip — these are handled by useChatRealtimeHandlers
        break;

      // tool_result is handled via attachment to tool_use above
      case 'tool_result': {
        if (msg.toolId && toolUseIds.has(msg.toolId)) {
          break;
        }

        // A result with a toolId but no matching tool_use in the loaded set is
        // almost always a tool_use/tool_result pair split across a pagination
        // boundary (older page not loaded yet). Rendering its raw content here
        // produces an unstyled dump that "fixes itself" once the older page
        // loads; skip it and let it attach to its tool_use when that arrives.
        if (msg.toolId) {
          break;
        }

        const content = formatToolResultContent(msg.content || '');
        if (!content.trim()) {
          break;
        }

        converted.push({
          type: msg.isError ? 'error' : 'assistant',
          content,
          timestamp: msg.timestamp,
          toolId: msg.toolId,
          isOrphanToolResult: true,
          ...sharedMetadata,
        });
        break;
      }

      default:
        break;
    }

    projectionCache.set(msg, {
      toolResultSource,
      subagentActivitySource,
      finishSource,
      // One source record can produce zero, one, or two UI messages (task
      // notifications with a result produce two), so cache the whole slice.
      messages: converted.slice(convertedStart),
    });
  }

  return converted;
}
