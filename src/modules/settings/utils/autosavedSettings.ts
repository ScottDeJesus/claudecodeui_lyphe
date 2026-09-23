import type {
  ClaudePermissionsState,
  CodexPermissionMode,
  CursorPermissionsState,
  NotificationPreferencesState,
  PermissionMode,
  ProjectSortOrder,
} from '@/shared/types';

/**
 * What the settings dialog auto-saves, split into the two sections whose truths arrive separately,
 * with the signature that says whether each section has moved since the server last spoke.
 *
 * The dialog writes on a debounce whenever its own state changes — and its own hydration lands as a
 * state change like any other. So "did the user change something" cannot be asked of that state:
 * opening the sheet would answer yes, and would write back the payload it had just read. It is asked
 * of these signatures instead — the values a save is about to send, rendered as one string, judged
 * against the same rendering of the values the last completed load read or the last successful save
 * sent. Equal means there is nothing to write, and nothing to announce.
 *
 * Two signatures rather than one because the halves can be known and unknown independently: the four
 * permission stores come off the local mirror in the first, synchronous batch, while the notification
 * preferences come off the wire in a later one and can fail on their own. One signature over all five
 * would put a failed notification read and a local store edit on the same side of the comparison —
 * which is how an edit to the sort order came to write notification defaults nobody had chosen.
 *
 * Both sides of each comparison are built by the function that also builds the payload, never one
 * from live state and the other from the wire: `permissionMode` is dropped when it has no value
 * (writing it as `undefined` would erase an edit mode the chat composer had just set), and two
 * hand-built copies of that rule would drift into a signature that says "changed" forever.
 *
 * Used only by `useSettingsController`.
 */

/** The permission stores as the mirror and the server hold them. Every field is optional because this describes a read of stored JSON, not of live state. */
export type ClaudeSettingsStorage = {
  allowedTools?: string[];
  disallowedTools?: string[];
  skipPermissions?: boolean;
  projectSortOrder?: ProjectSortOrder;
  permissionMode?: PermissionMode;
};

/** Cursor's permission stores, stored and read the same way. */
export type CursorSettingsStorage = {
  allowedCommands?: string[];
  disallowedCommands?: string[];
  skipPermissions?: boolean;
  permissionMode?: PermissionMode;
};

/** Codex's permission store, which is only ever the one edit mode. */
export type CodexSettingsStorage = {
  permissionMode?: CodexPermissionMode;
};

/** The four mirror-backed stores as one value: what a save hands the mirror, and what that half of the comparison is taken of. */
export type AutosavedStores = {
  claudePermissions: ClaudeSettingsStorage;
  projectSortOrder: ProjectSortOrder;
  cursorPermissions: CursorSettingsStorage;
  codexPermissions: CodexSettingsStorage;
};

/** The dialog's live state for those same four, which is what a save is handed before it is turned into a payload. */
export type AutosavedStoresState = {
  claudePermissions: ClaudePermissionsState;
  projectSortOrder: ProjectSortOrder;
  cursorPermissions: CursorPermissionsState;
  codexPermissions: CodexSettingsStorage;
};

/**
 * The notification switches the user has moved, as a value: one entry per leaf whose value differs
 * from the value it was measured against, and no entry for the leaves it does not.
 *
 * This exists because a notification control rebuilds the whole preferences object from whatever
 * state it was handed and hands it straight back — and during hydration that state is the placeholder
 * defaults. Treating the whole object as "what the user chose" would store every placeholder along
 * with the one switch they touched, which is exactly the silent loss these leaves prevent.
 */
export type NotificationPreferenceLeaves = {
  channels: Partial<NotificationPreferencesState['channels']>;
  events: Partial<NotificationPreferencesState['events']>;
};

/** Nothing touched. A fresh value per call: the leaves of one tap are folded into another, never mutated in place. */
export const noNotificationPreferenceLeaves = (): NotificationPreferenceLeaves => ({
  channels: {},
  events: {},
});

/** What a user who has never touched notification settings gets. */
export const createDefaultNotificationPreferences = (): NotificationPreferencesState => ({
  channels: {
    inApp: true,
    webPush: false,
    desktop: false,
    sound: true,
  },
  events: {
    actionRequired: true,
    stop: true,
    error: true,
    limits: true,
    background: false,
  },
});

/** Fills in what a stored payload left out, so a preference added after a row was written still has an answer. */
export const normalizeNotificationPreferences = (
  preferences?: Partial<NotificationPreferencesState> | null,
): NotificationPreferencesState => {
  const defaults = createDefaultNotificationPreferences();

  return {
    channels: {
      inApp: preferences?.channels?.inApp ?? defaults.channels.inApp,
      webPush: preferences?.channels?.webPush ?? defaults.channels.webPush,
      desktop: preferences?.channels?.desktop ?? defaults.channels.desktop,
      sound: preferences?.channels?.sound ?? defaults.channels.sound,
    },
    events: {
      actionRequired: preferences?.events?.actionRequired ?? defaults.events.actionRequired,
      stop: preferences?.events?.stop ?? defaults.events.stop,
      error: preferences?.events?.error ?? defaults.events.error,
      limits: preferences?.events?.limits ?? defaults.events.limits,
      background: preferences?.events?.background ?? defaults.events.background,
    },
  };
};

/** The store payload one save writes, and the value its signature is taken of. */
export function toAutosavedStores(state: AutosavedStoresState): AutosavedStores {
  return {
    claudePermissions: {
      allowedTools: state.claudePermissions.allowedTools,
      disallowedTools: state.claudePermissions.disallowedTools,
      skipPermissions: state.claudePermissions.skipPermissions,
      ...(state.claudePermissions.permissionMode ? { permissionMode: state.claudePermissions.permissionMode } : {}),
    },
    projectSortOrder: state.projectSortOrder,
    cursorPermissions: {
      allowedCommands: state.cursorPermissions.allowedCommands,
      disallowedCommands: state.cursorPermissions.disallowedCommands,
      skipPermissions: state.cursorPermissions.skipPermissions,
      ...(state.cursorPermissions.permissionMode ? { permissionMode: state.cursorPermissions.permissionMode } : {}),
    },
    codexPermissions: {
      permissionMode: state.codexPermissions.permissionMode,
    },
  };
}

/**
 * The one string two store payloads are compared by.
 *
 * Key order is the payload's own — `toAutosavedStores` is the only thing that builds one, which is
 * what keeps a comparison between a loaded payload and a to-be-saved payload meaningful rather than a
 * comparison of two spellings of the same values.
 */
export function autosavedStoresSignature(stores: AutosavedStores): string {
  return JSON.stringify(stores);
}

/** The same comparison for the notification preferences, which travel on their own and answer on their own. */
export function notificationPreferencesSignature(preferences: NotificationPreferencesState): string {
  return JSON.stringify(preferences);
}

/** The leaves of `after` that differ from `before` — what a tap moved, and nothing it left alone. */
export function notificationPreferenceLeaves(
  before: NotificationPreferencesState,
  after: NotificationPreferencesState,
): NotificationPreferenceLeaves {
  const leaves = noNotificationPreferenceLeaves();

  // Iterated off the value rather than enumerated, so a preference added to the dialog later is
  // compared without anyone having to remember to add a line here.
  for (const key of Object.keys(after.channels) as Array<keyof NotificationPreferencesState['channels']>) {
    if (before.channels[key] !== after.channels[key]) {
      leaves.channels[key] = after.channels[key];
    }
  }

  for (const key of Object.keys(after.events) as Array<keyof NotificationPreferencesState['events']>) {
    if (before.events[key] !== after.events[key]) {
      leaves.events[key] = after.events[key];
    }
  }

  return leaves;
}

/** True when at least one switch was touched — the only thing that can make a section whose truth was never read writable. */
export function hasNotificationPreferenceLeaves(leaves: NotificationPreferenceLeaves): boolean {
  return Object.keys(leaves.channels).length > 0 || Object.keys(leaves.events).length > 0;
}

/** The value a set of leaves describes, laid over a full preferences value — the user's own taps over the server's answer. */
export function overlayNotificationLeaves(
  base: NotificationPreferencesState,
  leaves: NotificationPreferenceLeaves,
): NotificationPreferencesState {
  return {
    channels: { ...base.channels, ...leaves.channels },
    events: { ...base.events, ...leaves.events },
  };
}

/** Folds one set of touched leaves into another: the later value for a switch wins, which is what a second tap on the same control means. */
export function foldNotificationLeaves(
  recorded: NotificationPreferenceLeaves,
  justChanged: NotificationPreferenceLeaves,
): NotificationPreferenceLeaves {
  return {
    channels: { ...recorded.channels, ...justChanged.channels },
    events: { ...recorded.events, ...justChanged.events },
  };
}
