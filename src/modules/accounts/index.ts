// The accounts module's public surface: the sidebar renders the row, and the settings module's
// Re-login door runs the same save-and-land flow the row's own Re-login does. Everything else — the
// panel, the meters, the Claude hooks — is this module's own business.
export { AccountFooterRow } from '@/modules/accounts/AccountFooterRow';
export { useReloginCapture } from '@/modules/accounts/hooks/useReloginCapture';
