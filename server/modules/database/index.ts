export { initializeDatabase } from '@/modules/database/init-db.js';
export { closeConnection, getConnection, getDatabasePath } from '@/modules/database/connection.js';
// The Cerberus store — a second SQLite file beside auth.db, with its own singleton and its own stepped
// schema — and its `cerberus-*.db.ts` repositories: used by the cerberus module, whose services read and write the
// store through them, and whose ingest and definition-write transactions open on its connection. It
// is not auth.db and no other module reads it.
export {
  closeCerberusConnection,
  getCerberusConnection,
  getCerberusDatabasePath,
} from '@/modules/database/cerberus-connection.js';
export { cerberusCatalogDb } from '@/modules/database/repositories/cerberus-catalog.db.js';
export type {
  CerberusCatalogChangeRow,
  CerberusCatalogRow,
  CerberusCatalogSetRow,
} from '@/modules/database/repositories/cerberus-catalog.db.js';
export { cerberusDefinitionsDb } from '@/modules/database/repositories/cerberus-definitions.db.js';
export type {
  CerberusActiveCheckRow,
  CerberusCheckRow,
  CerberusCheckUpsert,
  CerberusProbeRow,
} from '@/modules/database/repositories/cerberus-definitions.db.js';
export {
  CERBERUS_ONE_OFF_TTL_MS,
  cerberusDiagnosesDb,
} from '@/modules/database/repositories/cerberus-diagnoses.db.js';
export type {
  CerberusDiagnosisEndFields,
  CerberusDiagnosisInsert,
  CerberusDiagnosisRow,
  CerberusDiagnosisStatus,
  CerberusDiagnosisStepRow,
} from '@/modules/database/repositories/cerberus-diagnoses.db.js';
export { cerberusEnrollDb } from '@/modules/database/repositories/cerberus-enroll.db.js';
export type { CerberusEnrollTokenRow } from '@/modules/database/repositories/cerberus-enroll.db.js';
export { cerberusMutesDb } from '@/modules/database/repositories/cerberus-mutes.db.js';
export type { CerberusMuteRow } from '@/modules/database/repositories/cerberus-mutes.db.js';
export { cerberusNodesDb } from '@/modules/database/repositories/cerberus-nodes.db.js';
export type {
  CerberusNodeInsert,
  CerberusNodeRow,
} from '@/modules/database/repositories/cerberus-nodes.db.js';
export { cerberusRedAlertsDb } from '@/modules/database/repositories/cerberus-red-alerts.db.js';
export type {
  CerberusRedAlertClosedBy,
  CerberusRedAlertRow,
} from '@/modules/database/repositories/cerberus-red-alerts.db.js';
export { cerberusResultsDb } from '@/modules/database/repositories/cerberus-results.db.js';
export type {
  CerberusLatestResultRow,
  CerberusStoredResultRow,
  CerberusTransitionRow,
} from '@/modules/database/repositories/cerberus-results.db.js';
export { cerberusRunsDb } from '@/modules/database/repositories/cerberus-runs.db.js';
export type {
  CerberusRunInsert,
  CerberusRunLineRow,
  CerberusRunResult,
  CerberusRunRow,
  CerberusRunStatsRow,
} from '@/modules/database/repositories/cerberus-runs.db.js';
export { cerberusUpdatesDb } from '@/modules/database/repositories/cerberus-updates.db.js';
export type {
  CerberusPauseWindowRow,
  CerberusUpdateInsert,
  CerberusUpdateResult,
  CerberusUpdateRow,
  CerberusUpdateStepRow,
} from '@/modules/database/repositories/cerberus-updates.db.js';
export { apiKeysDb } from '@/modules/database/repositories/api-keys.js';
export { appConfigDb } from '@/modules/database/repositories/app-config.js';
// credentialsDb: used by the settings module's credentials routes and by the voice module, which keeps the account's one
// Gemini key here (credential_type 'gemini_api_key').
export { credentialsDb } from '@/modules/database/repositories/credentials.js';
// cronJobsDb: the cron registry's own tables — read by the schedules module's read service, written
// by its sync service and by the module's CLI door (add / remove / list / sync).
export { cronJobsDb } from '@/modules/database/repositories/cron-jobs.db.js';
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
// The followups lane's own table: one chat's next steps and known gaps, keyed on the chat's app session id.
// Used by the followups module; `sessions.db.ts` moves a merged chat's items itself.
export { followupsDb } from '@/modules/database/repositories/followups.db.js';
export type { FollowupKind, FollowupRow } from '@/modules/database/repositories/followups.db.js';
// The companion's own tables: Kaylee's per-account state, exchange (the newest 400 rows), note cards and record of the
// actions she prepared for his word, as rows — snake_case columns, JSON columns as text. Used by the companion module's
// store, which maps them to the wire contract.
export { companionDb } from '@/modules/database/repositories/companion.db.js';
export type {
  CompanionClearResult,
  CompanionFaceRow,
  CompanionHeardRow,
  CompanionLogInput,
  CompanionLogRow,
  CompanionNoteRow,
  CompanionStatePatch,
  CompanionStateRow,
} from '@/modules/database/repositories/companion.db.js';
export type {
  CompanionActionEnd,
  CompanionActionOpening,
  CompanionActionOutcome,
  CompanionActionRow,
} from '@/modules/database/repositories/companion-actions.db.js';
// Every brief Kaylee has relayed into a chat, keyed on the chat so it survives her Clear. Used by the companion
// module to record a send and by Providers to mark the matching user messages "Through Kaylee" in history.
export { relayedSendsDb } from '@/modules/database/repositories/relayed-sends.db.js';
export type { RelayedSendRow } from '@/modules/database/repositories/relayed-sends.db.js';
// The notes lane's own table: one account's cards, written one row at a time. It is not a board
// table and no board reads it.
export { notesDb } from '@/modules/database/repositories/notes.db.js';
export type { NoteRow } from '@/modules/database/repositories/notes.db.js';
export { notificationChannelEndpointsDb } from '@/modules/database/repositories/notification-channel-endpoints.js';
export { notificationPreferencesDb } from '@/modules/database/repositories/notification-preferences.js';
// notificationHistoryDb: what the house told each account — every row of the last seven days and, past that, the newest 300 — written
// and read by the notifications module's history service (`startNotificationHistory`, `listNotificationHistory`,
// `listNotificationHistorySince`). NOTIFICATION_HISTORY_WINDOW_MS: those seven days; handed on by the notifications module's barrel
// to the companion's strip read, the one reader of the week.
export {
  NOTIFICATION_HISTORY_WINDOW_MS,
  notificationHistoryDb,
} from '@/modules/database/repositories/notification-history.db.js';
export type { NotificationHistoryInput, NotificationHistoryRow } from '@/modules/database/repositories/notification-history.db.js';
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
export { onSessionArchiveChanged, onSessionsDeleted } from '@/modules/database/repositories/session-deletion.js';
// sessionCompactionsDb: used by the compaction module to swap a chat onto its compacted session and back, to hold a
// turn-end compaction until the context has grown past the latest one and to give a start-over its seed again
// (`latestCompaction`), and by Providers to stitch a compacted chat's history and index its old transcripts for
// search.
export { sessionCompactionsDb } from '@/modules/database/repositories/session-compactions.db.js';
// sessionUserStateDb: used by the chat run registry and the chat websocket to stamp completion and read, and by Providers to set an icon.
export { sessionUserStateDb } from '@/modules/database/repositories/session-user-state.db.js';
// simpleListDb: used by the providers module's simple-list service, for the list's folders and
// every move — through the ladder's own item and entry types, which stay where the ladder
// declares them.
export { simpleListDb } from '@/modules/database/repositories/simple-list.db.js';
export type { SimpleListFolderRow, SimpleListMoveVerdict } from '@/modules/database/repositories/simple-list.db.js';
export type { SimpleListLadderEntry, SimpleListLadderItem } from '@/modules/database/repositories/simple-list-ladder.db.js';
export { userDb } from '@/modules/database/repositories/users.js';
// userPreferencesDb: used by the User module to persist the settings that used to live in browser localStorage, by the
// companion for her settings, and by the voice module for the account's voice settings (the `voice` key).
export { userPreferencesDb } from '@/modules/database/repositories/user-preferences.db.js';
export { vapidKeysDb } from '@/modules/database/repositories/vapid-keys.js';
export { scheduledMessagesDb } from './repositories/scheduled-messages.db.js';
export type { ScheduledMessageRow, ScheduledMessageStatus } from './repositories/scheduled-messages.db.js';
