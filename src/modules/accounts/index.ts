// The accounts module's public surface: the project-workspace rail and the collapsed sidebar render the account
// button, and the settings module's Re-login door tells the panel when its window closed. Everything else — the
// panel, the meters, the Claude hooks — is this module's own business.
export { AccountRailButton } from '@/modules/accounts/AccountRailButton';
export { announceAccountsChanged } from '@/modules/accounts/hooks/useClaudeAccounts';
