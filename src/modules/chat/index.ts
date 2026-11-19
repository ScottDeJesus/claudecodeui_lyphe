export { default as ChatInterface } from '@/modules/chat/ChatInterface';
export { default as TokenUsageSummary, type TokenUsageSurface } from '@/modules/chat/composer/TokenUsageSummary';
export { default as ChatExportMenu, type ChatExportSurface } from '@/modules/chat/transcript/ChatExportMenu';
// The one transcript view, opened from a row: the chat's own subagent rows draw it in the pinned
// dialog, and it is the same view a kanban card drawer's walk stage opens. Consumer: the
// kanban module's card drawer (`card-drawer/KanbanCardDrawer.tsx`), which reads it through this barrel.
export { SubagentTranscriptView } from '@/modules/chat/subagents/SubagentTranscriptView';
// The words of a question, through the chat's own markdown renderer. Consumers: the dispatcher
// module's `LockAnswer` and `RoundAnswer`, so a plan's prompt reads in the same words and markdown
// as a question in the chat, and the companion module's `CompanionActionCard`, which draws the
// prompt of an action waiting for his word (an Accept census, a round's questions) as the Roadmap does.
export { QuestionText } from '@/modules/chat/tools/ContentRenderers/QuestionText';
// The material a model's replies wear (Opus the tube, Haiku the wire, Sonnet the plasma, the rest Mercury): the station's chat panel
// marks a chat's latest reply with it, as the transcript marks each reply.
export { replyMaterialOf } from '@/modules/chat/transcript/replyMark';
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
