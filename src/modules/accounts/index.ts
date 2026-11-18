// The accounts module's public surface: the project-workspace shell mounts the provider once above the rail and the main
// region with the one account switcher beside them, the rail renders the usage ring and the account button, a core wears the
// account's week as a ring (the chat's, and Kaylee's on the home and the station), and the settings module's Re-login door tells
// the panel when its window closed. Everything else — the panel, the dials, the Claude hooks — is this module's own business.
export { AccountsProvider } from '@/modules/accounts/context/AccountsContext';
export { AccountRailButton } from '@/modules/accounts/AccountRailButton';
export { AccountSwitcher } from '@/modules/accounts/AccountPopover';
export { AccountWeekRing } from '@/modules/accounts/AccountWeekRing';
export { useAccountWeek } from '@/modules/accounts/hooks/useAccountWeek';
export { UsageRings } from '@/modules/accounts/UsageRings';
export { announceAccountsChanged } from '@/modules/accounts/hooks/useClaudeAccounts';
