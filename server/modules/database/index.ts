export { initializeDatabase } from '@/modules/database/init-db.js';
export { closeConnection, getConnection, getDatabasePath } from '@/modules/database/connection.js';
export { apiKeysDb } from '@/modules/database/repositories/api-keys.js';
export { appConfigDb } from '@/modules/database/repositories/app-config.js';
export { credentialsDb } from '@/modules/database/repositories/credentials.js';
export { githubTokensDb } from '@/modules/database/repositories/github-tokens.js';
// The Kanban board's repositories: used by the kanban module — its board verbs mint through
// `kanbanIdsDb`, its cards are summarised through `kanbanCardsDb`, its audit log is appended
// through `kanbanEventsDb` by the one write seam.
// The card's approval, written by the approve gate: one statement, so an approval and the
// promotion a `not_ready` card takes with it cannot land apart.
export { kanbanApprovalsDb } from '@/modules/database/repositories/kanban-approvals.db.js';
export { kanbanBoardsDb } from '@/modules/database/repositories/kanban-boards.db.js';
export { kanbanCardTagsDb } from '@/modules/database/repositories/kanban-card-tags.db.js';
export { kanbanCardsDb } from '@/modules/database/repositories/kanban-cards.db.js';
// The lane's ordering operations, which need a status SET rather than one card: the move verb
// places a card against a lane's bounds and renumbers one when a midpoint runs out of room.
export { laneBounds, renormaliseLane } from '@/modules/database/repositories/kanban-cards-paging.db.js';
// The card's own row: the drawer reads the long fields off it, and the move verb reads the status
// it is leaving. The card repository never hands one out unmapped — this is the type of the value.
export type { KanbanCardRow } from '@/modules/database/repositories/kanban-cards-paging.db.js';
// The checklist, the attachments and the issues filed against a card: one repository, because the
// card drawer reads the three of them together and each is a small list owned by one card.
export { kanbanChecklistDb } from '@/modules/database/repositories/kanban-checklist.db.js';
export { kanbanEventsDb } from '@/modules/database/repositories/kanban-events.db.js';
export { kanbanIdsDb } from '@/modules/database/repositories/kanban-ids.db.js';
// The lesson store and the per-session usage ledger: what a build learned, staged for a person's
// review, and what each Metis session spent as its transcript grew. Neither is a card's child, so
// neither is reached through a card's read.
export { kanbanLearningDb } from '@/modules/database/repositories/kanban-learning.db.js';
// The two card leases, as compare-and-set statements on the card's own columns: the column names
// are a claim's, the verdict is the statement's `changes`.
export { kanbanLeasesDb } from '@/modules/database/repositories/kanban-leases.db.js';
// A card's questions and the decisions their answers became. The two travel together because an
// answer writes both in one mutate callback.
export { kanbanQuestionsDb } from '@/modules/database/repositories/kanban-questions.db.js';
// The memory-intake lane's own table: proposals to write a memory into one of five destinations,
// each waiting on a person's approval. It is not a board table and no board reads it.
export { memoryCandidatesDb } from '@/modules/database/repositories/memory-candidates.db.js';
export { notificationChannelEndpointsDb } from '@/modules/database/repositories/notification-channel-endpoints.js';
export { notificationPreferencesDb } from '@/modules/database/repositories/notification-preferences.js';
// providerModelsDb: used by Providers to persist user-managed custom model rows.
export { providerModelsDb } from '@/modules/database/repositories/provider-models.js';
// projectsDb: used by Projects, Worktrees, Git, WebSocket, and notification modules to persist and resolve project records.
export { projectsDb } from '@/modules/database/repositories/projects.db.js';
export { pushSubscriptionsDb } from '@/modules/database/repositories/push-subscriptions.js';
export { scanStateDb } from '@/modules/database/repositories/scan-state.db.js';
// sessionDraftsDb: used by User for drafts and Scheduled Messages for server-owned queued turns.
export { sessionDraftsDb } from '@/modules/database/repositories/session-drafts.db.js';
export type {
  QueuedSessionMessageRecord,
  SessionDraftRecord,
} from '@/modules/database/repositories/session-drafts.db.js';
export { sessionsDb } from '@/modules/database/repositories/sessions.db.js';
// sessionUserStateDb: used by the chat run registry and the chat websocket to stamp completion and read, and by Providers to set an icon or reorder the simple list.
export { sessionUserStateDb } from '@/modules/database/repositories/session-user-state.db.js';
export { userDb } from '@/modules/database/repositories/users.js';
// userPreferencesDb: used by the User module to persist the settings that used to live in browser localStorage.
export { userPreferencesDb } from '@/modules/database/repositories/user-preferences.db.js';
export { vapidKeysDb } from '@/modules/database/repositories/vapid-keys.js';
export { scheduledMessagesDb } from './repositories/scheduled-messages.db.js';
export type { ScheduledMessageRow, ScheduledMessageStatus } from './repositories/scheduled-messages.db.js';
