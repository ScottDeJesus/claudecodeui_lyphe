export { default as ChatInterface } from '@/modules/chat/ChatInterface';
export { default as TokenUsageSummary, type TokenUsageSurface } from '@/modules/chat/composer/TokenUsageSummary';
export { default as ChatExportMenu, type ChatExportSurface } from '@/modules/chat/transcript/ChatExportMenu';
// The open chat's pinned rows as the desktop gutter draws them: the list, and the transcript a row
// opens. Its consumer is the chat-gutters module, which mounts it as the Subagents widget.
export { SubagentWidgetBody } from '@/modules/chat/subagents/SubagentWidgetBody';
// The widget's "Clear completed", worn in the frame's HEADER rather than above its list: it is the
// Subagents widget's `HeaderAction`. Consumer: chat-gutters, which mounts it in the header slot.
export { SubagentWidgetClearCompleted } from '@/modules/chat/subagents/SubagentWidgetClearCompleted';
// How many rows that widget holds, for the count beside its tab. Consumer: chat-gutters.
export { useSubagentWidgetCount } from '@/modules/chat/hooks/useSubagentWidgetRows';
// Says "the strip lives in me now" for as long as a region draws those rows itself, so the chat
// stops drawing its own copy. Consumer: the chat-gutters module, whose layout claims the pinned
// strip exactly while its width draws the Subagents widget.
export { useClaimSubagentStrip } from '@/modules/chat/subagents/subagentSource';
// The one transcript view, opened from a row: the chat's own subagent rows draw it in the gutter
// and in the pinned dialog, and it is the same view a board Metis's row opens. Consumer: the
// kanban module's `KanbanMetisPanel.tsx`, which reads it through this barrel.
export { SubagentTranscriptView } from '@/modules/chat/subagents/SubagentTranscriptView';
// The Embed widget: the live page the chat named or the reader typed, as the desktop gutter draws
// it, plus what its layout reads — the count, the newest address, and whether the chat's list has
// arrived. Consumer: the chat-gutters module, which mounts it as the Embed widget. The publisher
// and the collector are NOT here — `ChatInterface` is their only caller and it is inside this
// module, so exporting them would be a door nobody walks through.
export { EmbedWidgetBody } from '@/modules/chat/embeds/EmbedWidgetBody';
export { useEmbedWidgetState } from '@/modules/chat/embeds/embedSource';
// The words of a question, through the chat's own markdown renderer. Consumers: the dispatcher
// module's `LockAnswer` and `RoundAnswer`, so a plan's prompt reads in the same words and markdown
// as a question in the chat, and the companion module's `CompanionActionCard`, which draws the
// prompt of an action waiting for his word (an Accept census, a round's questions) as the Roadmap does.
export { QuestionText } from '@/modules/chat/tools/ContentRenderers/QuestionText';
// The chips of the files waiting to be sent (with the warn line for the files an intake did not take), and the "Drop files here" overlay
// drawn while files are dragged onto a box. Consumer: the companion module's `CompanionComposer`, her box, which takes files as the chat does
// (`useAttachmentIntake`) and draws them the way the chat does, so the chat module stays the one home of how an attachment looks.
export { ComposerAttachmentTray } from '@/modules/chat/composer/ComposerAttachmentTray';
export { ComposerDropOverlay } from '@/modules/chat/composer/ComposerDropOverlay';
// How an attachment looks on a turn: pictures as squares that enlarge, other files as cards that download. Consumer: the companion
// module's `CompanionAttachments`, which draws the files he attached to a typed line above his words in her transcript (the chat's
// own size) and in her portrait's strip (`size: 'small'`), so the chat module stays the one home of that look.
export { default as ChatMessageImages } from '@/modules/chat/transcript/ChatMessageImages';
export { default as ChatMessageFiles } from '@/modules/chat/transcript/ChatMessageFiles';
