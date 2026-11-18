// The session panel's public surface: the one place a chat has to itself, in front of the talk when switched to, filled by the chat's own `panel`
// command (server/modules/session-panel) and read here.
//
// SessionPanelProvider: mounted by project-workspace's `WorkspaceMain` over the chat's head and its pane; it reads the panel of
// the chat on screen once, for the parts below.
export { SessionPanelProvider } from '@/modules/session-panel/SessionPanelProvider';
// SessionPanelLayout: used by `WorkspaceMain` round the chat's pane; it draws the panel in the chat's place while the reader
// has switched to it.
export { SessionPanelLayout } from '@/modules/session-panel/SessionPanelLayout';
// SessionPanelSwitch: used by project-workspace's `ChatHead`, as the way between the talk and the panel.
export { SessionPanelSwitch } from '@/modules/session-panel/SessionPanelSwitch';
// SessionFollowups: the chat's follow-ups drawn apart from the panel. Its consumer is project-workspace's `ChatDesk`, which
// stands them in the chat's side column at a desk.
export { SessionFollowups } from '@/modules/session-panel/SessionFollowups';
// SessionPanelMark and panelShownIdOf: used by the chat module's transcript (`ChatMessagesPane`), which marks the turn where the
// chat put a version on its panel.
export { SessionPanelMark } from '@/modules/session-panel/SessionPanelMark';
export { panelShownIdOf } from '@/modules/session-panel/panelMark';
