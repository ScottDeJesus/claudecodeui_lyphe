// The accounts module's public surface: the project-workspace shell mounts the provider once above the rail and the main
// region, the rail renders the usage rings and the account button, the chat-gutters module draws the Accounts widget's body, and the
// settings module's Re-login door tells the panel when its window closed. Everything else — the panel, the meters,
// the Claude hooks — is this module's own business.
export { AccountsProvider } from '@/modules/accounts/context/AccountsContext';
export { AccountRailButton } from '@/modules/accounts/AccountRailButton';
export { UsageRings } from '@/modules/accounts/UsageRings';
export { AccountsWidgetBody } from '@/modules/accounts/AccountsWidgetBody';
export { announceAccountsChanged } from '@/modules/accounts/hooks/useClaudeAccounts';
