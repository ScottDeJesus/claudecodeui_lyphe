export { default as ChatInterface } from '@/modules/chat/ChatInterface';
export { default as TokenUsageSummary, type TokenUsageSurface } from '@/modules/chat/composer/TokenUsageSummary';
export { default as ChatExportMenu, type ChatExportSurface } from '@/modules/chat/transcript/ChatExportMenu';
// The open chat's pinned rows as the desktop gutter draws them: the list, and the transcript a row
// opens. Its consumer is the chat-gutters module, which mounts it as the third widget.
export { SubagentWidgetBody } from '@/modules/chat/subagents/SubagentWidgetBody';
// How many rows that widget holds, for the count beside its tab. Consumer: chat-gutters.
export { useSubagentWidgetCount } from '@/modules/chat/hooks/useSubagentWidgetRows';
// Says "the strip lives in me now" for as long as a region draws those rows itself, so the chat
// stops drawing its own copy. Consumer: the chat-gutters module, whose layout claims the pinned
// strip exactly while its width draws the Subagents widget.
export { useClaimSubagentStrip } from '@/modules/chat/subagents/subagentSource';
