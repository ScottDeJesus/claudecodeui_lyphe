import { memo, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranchIcon, PencilIcon } from 'lucide-react';

import { LLMProviderLogo } from '@/shared/ui';
import { cn } from '@/shared/utils';

import type { ChatMessage, ClaudePermissionSuggestion, PermissionGrantResult, LLMProvider,DiffLine,Project } from '@/shared/types';
import { formatUsageLimitText, stripProposedPlanEnvelope } from '@/modules/chat/utils/chatFormatting';
import { ToolRenderer, ToolErrorDisplay, SubagentPanel, shouldHideToolResult } from '@/modules/chat/tools';
import type { ReadToolPermissionState } from '@/modules/chat/hooks/useToolPermissionState';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/modules/chat/transcript/Reasoning';
import ChatMessageImages from '@/modules/chat/transcript/ChatMessageImages';
import ChatMessageFiles from '@/modules/chat/transcript/ChatMessageFiles';
import { Markdown, TRANSCRIPT_PROSE } from '@/modules/chat/transcript/Markdown';
import StreamingMarkdown from '@/modules/chat/transcript/StreamingMarkdown';
import MessageCopyControl from '@/modules/chat/transcript/MessageCopyControl';
import MessageSpeakControl from '@/modules/chat/transcript/MessageSpeakControl';
import CollapsibleUserText from '@/modules/chat/transcript/CollapsibleUserText';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { MemoryCitations } from '@/modules/chat/transcript/MemoryCitations';

type MessageComponentProps = {
  message: ChatMessage;
  prevMessage: ChatMessage | null;
  /** This message is the prose reply that closes its run; it ends with the time it landed. */
  isRunTerminal?: boolean;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: LLMProvider | string;
  /**
   * Loads this message back into the composer to be replaced. Absent when the
   * provider cannot re-run a conversation from a chosen point, which is what
   * hides the affordance rather than showing one that would fail.
   */
  onEditMessage?: (message: ChatMessage) => void;
  /**
   * Branches the conversation into a new session ending at this message.
   * Absent when the provider cannot copy a transcript prefix.
   */
  onForkFromMessage?: (message: ChatMessage) => void;
  /**
   * Turns a model id into the name the catalog shows for it, or null when the
   * catalog has never heard of it. A raw id is never a label, so a null here
   * falls back to the provider's own name rather than printing the id.
   */
  resolveModelLabel?: (modelId: string) => string | null;
  /**
   * Asks whether this tool call is blocked on a person, or was allowed by one.
   * Absent in an export, where the answer is unknowable and the row says nothing.
   */
  readToolPermissionState?: ReadToolPermissionState;
};

const COPY_HIDDEN_TOOL_NAMES = new Set(['Bash', 'Edit', 'Write', 'ApplyPatch']);

/**
 * Rendered by chat's ChatMessagesPane and ToolGroupContainer to draw one
 * transcript entry — user turn, assistant turn, or a tool call and its result.
 */
const MessageComponent = memo(({ message, prevMessage, isRunTerminal, createDiff, onFileOpen, showRawParameters, showThinking, selectedProject, provider, onEditMessage, onForkFromMessage, resolveModelLabel, readToolPermissionState }: MessageComponentProps) => {
  const { t, i18n } = useTranslation('chat');
  const isGrouped = prevMessage && prevMessage.type === message.type &&
    ((prevMessage.type === 'assistant') ||
      (prevMessage.type === 'user') ||
      (prevMessage.type === 'tool') ||
      (prevMessage.type === 'error'));
  const messageRef = useRef<HTMLDivElement | null>(null);
  const userCopyContent = String(message.content || '');
  const formattedMessageContent = useMemo(
    () => {
      const content = formatUsageLimitText(String(message.content || ''));
      return provider === 'codex' && message.type === 'assistant' && !message.isThinking
        ? stripProposedPlanEnvelope(content)
        : content;
    },
    [message.content, message.isThinking, message.type, provider]
  );
  const assistantCopyContent = message.isToolUse
    ? String(message.displayText || message.content || '')
    : formattedMessageContent;
  const isCommandOrFileEditToolResponse = Boolean(
    message.isToolUse && COPY_HIDDEN_TOOL_NAMES.has(String(message.toolName || ''))
  );
  // Copy and speak are affordances for a live conversation. In an exported
  // document there is nothing to click, and rendering them statically would
  // also pull in browser-only voice state that a document render has no
  // provider for.
  const isExporting = useIsExportingTranscript();
  const shouldShowUserCopyControl = !isExporting && message.type === 'user' && userCopyContent.trim().length > 0;
  const shouldShowAssistantCopyControl = !isExporting &&
    message.type === 'assistant' &&
    assistantCopyContent.trim().length > 0 &&
    !isCommandOrFileEditToolResponse &&
    !message.isThinking;


  // Hours and minutes only: seconds are noise in a transcript nobody times.
  // Formatted in the app's language, not the browser's.
  const messageTime = useMemo(() => {
    const date = new Date(message.timestamp);
    const isValid = !Number.isNaN(date.getTime());
    return {
      date,
      isValid,
      formatted: isValid ? date.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) : '',
    };
  }, [message.timestamp, i18n.language]);
  const formattedTime = messageTime.formatted;
  // The reply that closes a run ends with the time it landed, in place of the
  // time in its caption: after a long run it is the end the reader wants, and
  // the caption is hidden anyway when the reply follows tool calls. A live
  // affordance only — an exported document keeps the caption time instead.
  const shouldShowResponseTime =
    Boolean(isRunTerminal) &&
    !isExporting &&
    message.type === 'assistant' &&
    !message.isToolUse &&
    !message.isThinking &&
    !message.isStreaming &&
    messageTime.isValid &&
    assistantCopyContent.trim().length > 0;
  const shouldHideThinkingMessage = Boolean(message.isThinking && !showThinking);

  const providerName = provider === 'cursor'
    ? t('messageTypes.cursor')
    : provider === 'codex'
      ? t('messageTypes.codex')
      : provider === 'opencode'
        ? t('messageTypes.opencode', { defaultValue: 'OpenCode' })
        : t('messageTypes.claude');

  // Which model answered, in the catalog's own words. An id the catalog does not
  // know resolves to nothing and the provider's name stands in — a raw
  // `claude-haiku-…` is an identifier, and identifiers are not labels.
  const speakerName = message.type === 'error'
    ? t('messageTypes.error')
    : message.type === 'tool'
      ? t('messageTypes.tool')
      : (message.model && resolveModelLabel?.(message.model)) || providerName;

  const permissionState = readToolPermissionState?.(message.toolName, message.toolInput) ?? 'idle';

  if (shouldHideThinkingMessage) {
    return null;
  }
  return (
    <div
      ref={messageRef}
      data-message-timestamp={message.timestamp || undefined}
      className={`chat-message ${message.type} ${isGrouped ? 'grouped' : ''} ${message.type === 'user' ? 'flex justify-end px-3 sm:px-0' : 'px-3 sm:px-0'}`}
    >
      {message.type === 'user' ? (
        /* User turn on the right: claude.ai-style attachment cards above the bubble */
        <div className="flex w-full items-end space-x-0 sm:w-auto sm:max-w-[85%] sm:space-x-3 md:max-w-md lg:max-w-lg xl:max-w-xl">
          <div className="flex min-w-0 flex-1 flex-col items-end gap-2 sm:flex-initial">
            {message.images && message.images.length > 0 && (
              <ChatMessageImages
                images={message.images}
                projectId={selectedProject?.projectId}
              />
            )}
            {message.files && message.files.length > 0 && (
              <ChatMessageFiles files={message.files} />
            )}
            {userCopyContent.trim().length > 0 || (!message.images?.length && !message.files?.length) ? (
              /* The row paints nothing past its own box (`.chat-message` is paint-contained),
                 so from `sm` up, where the row has no side padding, the bubble stands in from
                 the edge by the tail's reach — flush, the tail would be clipped away. */
              <div data-side="end" className="vv-bubble group max-w-full bg-secondary px-4 py-3 text-foreground sm:mr-2.5" style={{ borderRadius: 'var(--radius-card)' }}>
                <div className="mb-1.5 text-xs uppercase tracking-[0.14em] text-ink-faint">
                  {messageTime.isValid ? `${t('messageTypes.you', { defaultValue: 'You' })} · ${formattedTime}` : t('messageTypes.you', { defaultValue: 'You' })}
                </div>
                <CollapsibleUserText turnKey={message.transcriptAnchorId || String(message.timestamp)}>
                  <div dir="auto" className="break-words font-serif text-base">
                    <Markdown
                      breaks
                      className={TRANSCRIPT_PROSE}
                    >
                      {message.content}
                    </Markdown>
                  </div>
                </CollapsibleUserText>
                <div className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                  {onEditMessage && message.transcriptAnchorId && (
                    <button
                      type="button"
                      onClick={() => onEditMessage(message)}
                      title={t('message.editAndResend')}
                      aria-label={t('message.editAndResend')}
                      className="rounded p-1 opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onForkFromMessage && message.transcriptAnchorId && (
                    <button
                      type="button"
                      onClick={() => onForkFromMessage(message)}
                      title={t('message.forkFromHere')}
                      aria-label={t('message.forkFromHere')}
                      className="rounded p-1 opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <GitBranchIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {shouldShowUserCopyControl && (
                    <MessageCopyControl content={userCopyContent} messageType="user" />
                  )}
                </div>
              </div>
            ) : (
              /* Attachment-only turn: no text bubble, but the caption still shows */
              <div className="flex items-center justify-end gap-1 text-xs uppercase tracking-[0.14em] text-ink-faint">
                {messageTime.isValid ? `${t('messageTypes.you', { defaultValue: 'You' })} · ${formattedTime}` : t('messageTypes.you', { defaultValue: 'You' })}
              </div>
            )}
          </div>
        </div>
      ) : message.isTaskNotification ? (
        /* Compact task notification on the left */
        <div className="w-full">
          <div className="flex items-center gap-2 py-0.5">
            <span className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${message.taskStatus === 'completed' ? 'bg-primary' : 'bg-warn-ink'}`} />
            <span className="text-xs text-muted-foreground">{message.content}</span>
          </div>
        </div>
      ) : (
        /* Claude/Error/Tool messages on the left */
        <div className="w-full">
          {!isGrouped && (
            /* One mark and one caption, whoever is speaking.
               A model's turn is marked by the LOGO of the agent that answered — the same
               `LLMProviderLogo` the sidebar puts on every session row — because that mark
               says WHO, and a plain disc said nothing a reader could not already read in
               the caption. Error and tool turns keep a dot: they are STATES, not speakers,
               and no provider owns them. An error turn is amber rather than red — nothing
               here is destructive, something went wrong — and it says so in the word beside
               the dot, so the state survives a screen with no colour at all. */
            <div className="mb-2.5 flex items-center gap-2.5">
              {message.type === 'error' || message.type === 'tool' ? (
                <span
                  aria-hidden="true"
                  className={`h-5 w-5 flex-none rounded-full ${
                    message.type === 'error' ? 'bg-warn-ink' : 'bg-border'
                  }`}
                />
              ) : (
                <LLMProviderLogo provider={provider} className="h-5 w-5 flex-none" />
              )}
              <span className="text-xs uppercase tracking-[0.14em] text-ink-faint">
                {shouldShowResponseTime || !messageTime.isValid ? speakerName : `${speakerName} · ${formattedTime}`}
              </span>
            </div>
          )}

          <div className="w-full">

            {message.isSubagentContainer ? (
              /* A spawned agent owns its whole card — header, timeline and
                 result — so it never goes through the tool input/result pair. */
              <SubagentPanel
                toolInput={message.toolInput}
                toolResult={message.toolResult}
                toolResultAt={message.toolResultAt as string | number | Date | undefined}
                subagent={message.subagent}
                activity={message.subagentActivity}
                usage={message.subagentUsage}
                onFileOpen={onFileOpen}
                createDiff={createDiff}
                selectedProject={selectedProject}
              />
            ) : message.isToolUse ? (
              <>
                <div className="flex flex-col">
                  <div className="flex flex-col">
                    <Markdown className={TRANSCRIPT_PROSE}>
                      {String(message.displayText || '')}
                    </Markdown>
                  </div>
                </div>

                {message.toolInput && (
                  <ToolRenderer
                    toolName={message.toolName || 'UnknownTool'}
                    toolInput={message.toolInput}
                    toolResult={message.toolResult}
                    toolId={message.toolId}
                    mode="input"
                    onFileOpen={onFileOpen}
                    createDiff={createDiff}
                    selectedProject={selectedProject}
                    showRawParameters={showRawParameters}
                    rawToolInput={typeof message.toolInput === 'string' ? message.toolInput : undefined}
                    toolStatus={message.toolStatus}
                    permissionState={permissionState}
                  />
                )}

                {/* Tool Result Section — Bash renders its output inside the command row above. */}
                {message.toolResult && message.toolName !== 'Bash' && !shouldHideToolResult(message.toolName || 'UnknownTool', message.toolResult) && (
                  message.toolResult.isError ? (
                    // Error results — collapsed red row that expands to the content
                    <div id={`tool-result-${message.toolId}`} className="scroll-mt-4">
                      <ToolErrorDisplay
                        label={t('messageTypes.error')}
                        content={String(message.toolResult.content || '')}
                      />
                    </div>
                  ) : (
                    // Non-error results - route through ToolRenderer (single source of truth)
                    <div id={`tool-result-${message.toolId}`} className="scroll-mt-4">
                      <ToolRenderer
                        toolName={message.toolName || 'UnknownTool'}
                        toolInput={message.toolInput}
                        toolResult={message.toolResult}
                        toolId={message.toolId}
                        mode="result"
                        onFileOpen={onFileOpen}
                        createDiff={createDiff}
                        selectedProject={selectedProject}
                      />
                    </div>
                  )
                )}
              </>
            ) : message.isThinking ? (
              /* Thinking: a dashed card, because it is a note to itself rather
                 than part of the answer. The border says so before the words do. */
              <Reasoning
                defaultOpen={isExporting}
                className="border-[1.5px] border-dashed border-input px-4 py-3.5"
                style={{ borderRadius: 'var(--radius-card)' }}
              >
                <ReasoningTrigger
                  getThinkingMessage={(_isStreaming, duration) => (
                    <span className="font-serif text-[17px] italic text-ink-faint">
                      {t('thinking.card', { defaultValue: 'Thinking' })}
                      {typeof duration === 'number' && duration > 0 ? ` · ${duration}s` : ''}
                    </span>
                  )}
                />
                <ReasoningContent>
                  <Markdown className={cn(TRANSCRIPT_PROSE, 'prose-gray')}>
                    {message.content}
                  </Markdown>
                  {!isExporting && (
                    <div className="mt-3 flex items-center text-[11px]">
                      <MessageCopyControl content={String(message.content || '')} messageType="assistant" />
                    </div>
                  )}
                </ReasoningContent>
              </Reasoning>
            ) : (
              <div dir="auto" className="text-[15px] leading-relaxed text-foreground">
                {/* Reasoning accordion */}
                {showThinking && message.reasoning && (
                  <Reasoning className="mb-3" defaultOpen={false}>
                    <ReasoningTrigger />
                    <ReasoningContent>
                      <div className="whitespace-pre-wrap">
                        {message.reasoning}
                      </div>
                    </ReasoningContent>
                  </Reasoning>
                )}

                {(() => {
                  const content = formattedMessageContent;

                  // Detect if content is pure JSON (starts with { or [)
                  const trimmedContent = content.trim();
                  if ((trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) &&
                    (trimmedContent.endsWith('}') || trimmedContent.endsWith(']'))) {
                    try {
                      const parsed = JSON.parse(trimmedContent);
                      const formatted = JSON.stringify(parsed, null, 2);

                      return (
                        <div className="my-2">
                          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            <span className="font-medium">{t('json.response')}</span>
                          </div>
                          <div className="overflow-hidden rounded-lg border border-border bg-muted">
                            <pre className="overflow-x-auto p-4">
                              <code className="block whitespace-pre font-mono text-sm text-foreground">
                                {formatted}
                              </code>
                            </pre>
                          </div>
                        </div>
                      );
                    } catch {
                      // Not valid JSON, fall through to normal rendering
                    }
                  }

                  // Normal rendering for non-JSON content
                  // One component for both states on purpose: swapping element
                  // types here remounted the whole reply the instant it finished.
                  return message.type === 'assistant' ? (
                    <StreamingMarkdown
                      content={content}
                      isStreaming={Boolean(message.isStreaming)}
                      className={cn(TRANSCRIPT_PROSE, 'prose-gray')}
                    />
                  ) : (
                    <div className="whitespace-pre-wrap">
                      {content}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Outside the branches on purpose: a provider can cite memory on a
                plain reply or on the plan card it turned that reply into. */}
            {Array.isArray(message.memoryCitations) && message.memoryCitations.length > 0 && (
              <MemoryCitations citations={message.memoryCitations} />
            )}

            {(shouldShowAssistantCopyControl || shouldShowResponseTime) && (
              <div className="mt-1 flex w-full items-center gap-2 text-[11px] text-ink-faint">
                {shouldShowAssistantCopyControl && (
                  <MessageCopyControl content={assistantCopyContent} messageType="assistant" />
                )}
                {shouldShowAssistantCopyControl && (
                  <MessageSpeakControl content={assistantCopyContent} />
                )}
                {shouldShowResponseTime && (
                  <time
                    dateTime={messageTime.date.toISOString()}
                    title={messageTime.date.toLocaleString(i18n.language)}
                    aria-label={t('responseTime.repliedAt', { time: formattedTime })}
                    className="ml-auto tabular-nums"
                  >
                    {formattedTime}
                  </time>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default MessageComponent;

