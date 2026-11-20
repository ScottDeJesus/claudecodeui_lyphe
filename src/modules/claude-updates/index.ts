/**
 * The Claude updates module, as the rest of the app sees it: the Settings tab, the sidebar row that
 * opens it, and the row's two lines for a reader that marks the offer elsewhere. Everything else here —
 * the client hook, the cards, the notes and the job panel — is composed by the tab and stays inside the
 * module.
 */
export { ClaudeUpdatesSettingsTab } from '@/modules/claude-updates/ClaudeUpdatesSettingsTab';
export { ClaudeUpdateFooterRow } from '@/modules/claude-updates/ClaudeUpdateFooterRow';
// Read by project-workspace's PlacesProvider, which marks Settings in the wheel of places while an offer stands.
export { useClaudeUpdateLine } from '@/modules/claude-updates/hooks/useClaudeUpdateLine';
