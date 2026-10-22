// The accounts module's public surface: the sidebar renders the row, and the settings module's
// Re-login door tells the panel when its window closed. Everything else — the panel, the meters,
// the Claude hooks — is this module's own business.
export { AccountFooterRow } from '@/modules/accounts/AccountFooterRow';
export { announceAccountsChanged } from '@/modules/accounts/hooks/useClaudeAccounts';
