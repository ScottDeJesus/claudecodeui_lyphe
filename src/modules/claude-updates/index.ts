/**
 * The Claude updates module, as the rest of the app sees it: the Settings tab, and the two forms of
 * the sidebar row that opens it. Everything else here — the client hook, the cards, the notes and
 * the job panel — is composed by the tab and stays inside the module.
 */
export { ClaudeUpdatesSettingsTab } from '@/modules/claude-updates/ClaudeUpdatesSettingsTab';
export {
  ClaudeUpdateFooterRow,
  ClaudeUpdateRailButton,
} from '@/modules/claude-updates/ClaudeUpdateFooterRow';
