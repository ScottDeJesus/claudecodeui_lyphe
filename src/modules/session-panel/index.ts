// The session panel's public surface: the one place beside the talk that a chat has to itself, filled by the chat's own `panel`
// command (server/modules/session-panel) and read here.
//
// SessionPanelProvider: mounted by project-workspace's `WorkspaceMain` over the chat's head and its pane; it reads the panel of
// the chat on screen once, for the three parts below.
export { SessionPanelProvider } from '@/modules/session-panel/SessionPanelProvider';
// SessionPanelLayout: used by `WorkspaceMain` round the chat's pane; it draws the panel beside the chat (or in front of it, on a
// narrow screen).
export { SessionPanelLayout } from '@/modules/session-panel/SessionPanelLayout';
// SessionPanelSwitch: used by project-workspace's `ChatHead`, as the narrow screen's way between the talk and the panel.
export { SessionPanelSwitch } from '@/modules/session-panel/SessionPanelSwitch';
// SessionPanelMark and panelShownIdOf: used by the chat module's transcript (`ChatMessagesPane`), which marks the turn where the
// chat put a version on its panel.
export { SessionPanelMark } from '@/modules/session-panel/SessionPanelMark';
export { panelShownIdOf } from '@/modules/session-panel/panelMark';
