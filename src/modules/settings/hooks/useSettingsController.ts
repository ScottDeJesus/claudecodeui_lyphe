import { useCallback, useEffect, useRef, useState } from 'react';

import { useTheme } from '@/shared/context/ThemeContext';
import { api } from '@/shared/api';
import { setNotificationSoundEnabled } from '@/shared/utils';
import {
  readUserPreference,
  writeUserPreferences,
} from '@/shared/userSettings';
import { useProviderAuthStatus } from '@/modules/provider-auth';
import {
  autosavedStoresSignature,
  createDefaultNotificationPreferences,
  foldNotificationLeaves,
  hasNotificationPreferenceLeaves,
  noNotificationPreferenceLeaves,
  normalizeNotificationPreferences,
  notificationPreferenceLeaves,
  notificationPreferencesSignature,
  overlayNotificationLeaves,
  toAutosavedStores,
} from '@/modules/settings/utils/autosavedSettings';
import type { ClaudeSettingsStorage, CodexSettingsStorage, CursorSettingsStorage, NotificationPreferenceLeaves } from '@/modules/settings/utils/autosavedSettings';
import type { AgentProvider, ClaudePermissionsState, CodexPermissionMode, CursorPermissionsState, NotificationPreferencesState, ProjectSortOrder, SettingsMainTab } from '@/shared/types';

const DEFAULT_CURSOR_PERMISSIONS: CursorPermissionsState = {
  allowedCommands: [],
  disallowedCommands: [],
  skipPermissions: false,
};

type ThemeContextValue = {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
};

type UseSettingsControllerArgs = {
  isOpen: boolean;
  initialTab: string;
};

type NotificationPreferencesResponse = {
  success?: boolean;
  preferences?: NotificationPreferencesState;
};

type ActiveLoginProvider = AgentProvider | '';

/**
 * Which authorization the embedded terminal is running. `account` is the provider's own CLI login and
 * is what the modal has always done; `design` is Claude Design's separate claude.ai grant, which runs
 * in the same terminal but is not a sign-in for this account at all — the two must not be confused
 * when the terminal exits, because only one of them leaves a credential the app reads afterwards.
 */
type LoginFlow = 'account' | 'design';

// Every tab the sidebar can land on. A tab missing from here is silently rewritten to
// "agents" when a caller deep-links to it, which is how Voice became unreachable by name.
const KNOWN_MAIN_TABS: SettingsMainTab[] = ['agents', 'appearance', 'git', 'tasks', 'notifications', 'api', 'voice', 'plugins', 'browser', 'about'];

const normalizeMainTab = (tab: string): SettingsMainTab => {
  // Keep backwards compatibility with older callers that still pass "tools".
  if (tab === 'tools') {
    return 'agents';
  }

  return KNOWN_MAIN_TABS.includes(tab as SettingsMainTab) ? (tab as SettingsMainTab) : 'agents';
};

const toCodexPermissionMode = (value: unknown): CodexPermissionMode => {
  if (value === 'acceptEdits' || value === 'bypassPermissions') {
    return value;
  }

  return 'default';
};

const toResponseJson = async <T>(response: Response): Promise<T> => response.json() as Promise<T>;

/**
 * The notification preferences the server holds, or `null` when the read produced no usable answer —
 * a failed request, a timeout, a refusal. The two are told apart deliberately: a null answer is the
 * absence of a truth, and every caller here treats it as one rather than as a set of defaults, because
 * the defaults are the client's own invention and writing them back is how a user's stored switches
 * are lost. The server always answers with a row (it creates one on first read), so null is never an
 * empty-account case — only a read that failed.
 */
async function readServerNotificationPreferences(): Promise<NotificationPreferencesState | null> {
  try {
    const response = await api.settings.notificationPreferences();
    if (!response.ok) {
      return null;
    }

    const data = await toResponseJson<NotificationPreferencesResponse>(response);
    if (!data.success || !data.preferences) {
      return null;
    }

    return normalizeNotificationPreferences(data.preferences);
  } catch (error) {
    console.error('Error reading notification preferences:', error);
    return null;
  }
}

const createEmptyClaudePermissions = (): ClaudePermissionsState => ({
  allowedTools: [],
  disallowedTools: [],
  skipPermissions: false,
});

const createEmptyCursorPermissions = (): CursorPermissionsState => ({
  ...DEFAULT_CURSOR_PERMISSIONS,
});

export function useSettingsController({ isOpen, initialTab }: UseSettingsControllerArgs) {
  const { isDarkMode, toggleDarkMode } = useTheme() as ThemeContextValue;
  const closeTimerRef = useRef<number | null>(null);

  const [activeTab, setActiveTab] = useState<SettingsMainTab>(() => normalizeMainTab(initialTab));
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>('name');
  const [claudePermissions, setClaudePermissions] = useState<ClaudePermissionsState>(() => (
    createEmptyClaudePermissions()
  ));
  const [cursorPermissions, setCursorPermissions] = useState<CursorPermissionsState>(() => (
    createEmptyCursorPermissions()
  ));
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferencesState>(() => (
    createDefaultNotificationPreferences()
  ));
  const [codexPermissionMode, setCodexPermissionMode] = useState<CodexPermissionMode>('default');

  // The signature of what the server last agreed with, one per section: rewritten by every load
  // that read that section and by every save that landed. This is the one thing an auto-save is
  // measured against, so a change batch produced by a load is not mistaken for a change the user
  // made. `null` is not "the defaults" — it is "never read", and it makes its section unwritable
  // until a read produces a truth to measure from.
  const [syncedStoresSignature, setSyncedStoresSignature] = useState<string | null>(null);
  const [syncedNotificationsSignature, setSyncedNotificationsSignature] = useState<string | null>(null);

  // The notification switches the user has moved since the server last agreed with them, as their
  // own values. Held in a ref because it is bookkeeping rather than something the dialog renders,
  // and kept across loads because it is the only record that a tap happened before the answer to
  // it did — the answer must be merged under it, not written over it.
  const editedNotificationLeavesRef = useRef<NotificationPreferenceLeaves>(noNotificationPreferenceLeaves());

  // The modal is open and which of the two authorizations it was opened for. Held rather than derived
  // from the provider, because the design flow runs on the same provider the account flow does.
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginProvider, setLoginProvider] = useState<ActiveLoginProvider>('');
  const [loginFlow, setLoginFlow] = useState<LoginFlow>('account');
  const {
    providerAuthStatus,
    checkProviderAuthStatus,
    refreshProviderAuthStatuses,
  } = useProviderAuthStatus();

  /** Reads every autosaved section and adopts it as what the dialog shows. */
  const loadSettings = useCallback(async () => {
    // What this load adopts, kept as it is set. Each section's baseline is declared from the values
    // this read produced rather than read back out of state, because the setters below have not
    // rendered by the time the read is over.
    let claudePermissionsRead = createEmptyClaudePermissions();
    let projectSortOrderRead: ProjectSortOrder = 'name';
    let cursorPermissionsRead = createEmptyCursorPermissions();
    let codexPermissionModeRead: CodexPermissionMode = 'default';

    try {
      const savedClaudeSettings = readUserPreference<ClaudeSettingsStorage>('claudePermissions', {});
      claudePermissionsRead = {
        allowedTools: savedClaudeSettings.allowedTools || [],
        disallowedTools: savedClaudeSettings.disallowedTools || [],
        skipPermissions: Boolean(savedClaudeSettings.skipPermissions),
        permissionMode: savedClaudeSettings.permissionMode,
      };
      setClaudePermissions(claudePermissionsRead);

      projectSortOrderRead = readUserPreference<ProjectSortOrder>('projectSortOrder', 'name') === 'date' ? 'date' : 'name';
      setProjectSortOrder(projectSortOrderRead);

      const savedCursorSettings = readUserPreference<CursorSettingsStorage>('cursorPermissions', {});
      cursorPermissionsRead = {
        allowedCommands: savedCursorSettings.allowedCommands || [],
        disallowedCommands: savedCursorSettings.disallowedCommands || [],
        skipPermissions: Boolean(savedCursorSettings.skipPermissions),
        permissionMode: savedCursorSettings.permissionMode,
      };
      setCursorPermissions(cursorPermissionsRead);

      const savedCodexSettings = readUserPreference<CodexSettingsStorage>('codexPermissions', {});
      codexPermissionModeRead = toCodexPermissionMode(savedCodexSettings.permissionMode);
      setCodexPermissionMode(codexPermissionModeRead);
    } catch (error) {
      console.error('Error loading settings:', error);
      claudePermissionsRead = createEmptyClaudePermissions();
      projectSortOrderRead = 'name';
      cursorPermissionsRead = createEmptyCursorPermissions();
      codexPermissionModeRead = 'default';
      setClaudePermissions(claudePermissionsRead);
      setProjectSortOrder(projectSortOrderRead);
      setCursorPermissions(cursorPermissionsRead);
      setCodexPermissionMode(codexPermissionModeRead);
    }

    // The store half is in hand before this line, so its baseline is declared here, in the same
    // commit as the values themselves. That is what lets a store edit made while the notification
    // read below is still in flight be a difference from a truth rather than a difference from a
    // placeholder — and it is why the flush that ships such an edit has something to compare with.
    setSyncedStoresSignature(autosavedStoresSignature(toAutosavedStores({
      claudePermissions: claudePermissionsRead,
      projectSortOrder: projectSortOrderRead,
      cursorPermissions: cursorPermissionsRead,
      codexPermissions: { permissionMode: codexPermissionModeRead },
    })));

    const serverPreferences = await readServerNotificationPreferences();
    if (serverPreferences === null) {
      // No answer is not an answer. The stored preferences are unknown, so the dialog keeps showing
      // what it held and its baseline stays null: nothing measured against a value nobody read may
      // be written. The one exception is a switch the user moved themselves, which the save takes
      // with it by reading the truth first — see `saveSettings`.
      return;
    }

    // The user's own taps, if any, are laid OVER the server's answer rather than being overwritten
    // by it, because the answer is older news than the tap. Every switch the user did not touch
    // keeps the value the server holds, which is the whole difference between adopting an answer
    // and answering with the placeholders that answer replaced.
    const merged = overlayNotificationLeaves(serverPreferences, editedNotificationLeavesRef.current);
    editedNotificationLeavesRef.current = notificationPreferenceLeaves(serverPreferences, merged);
    setNotificationPreferences(merged);

    // The baseline is the server's answer, not the merge: a tap that agrees with the server settles
    // as no change at all, and one that does not is still an edit waiting to be written.
    setSyncedNotificationsSignature(notificationPreferencesSignature(serverPreferences));
  }, []);

  /**
   * The setter the notifications tab and the push handlers are given, which records what the user
   * actually moved before handing the value on.
   *
   * The difference is taken against `previous` — React's own answer to "what was on screen when this
   * control was moved" — because every caller builds its new value by spreading the state it was
   * given. That is right for the screen and wrong for the wire: during hydration the state being
   * spread is a placeholder, so recording the whole value would store every placeholder along with
   * the one switch the user touched.
   */
  const updateNotificationPreferences = useCallback((value: NotificationPreferencesState) => {
    setNotificationPreferences((previous) => {
      // Recorded inside the updater because `previous` is the only one of the two that is not a
      // guess, and folded rather than replaced because a second tap on the same switch means the
      // later value, not a second entry. A re-run (React calls an updater twice in development)
      // writes the same leaves twice, which is the same leaves.
      editedNotificationLeavesRef.current = foldNotificationLeaves(
        editedNotificationLeavesRef.current,
        notificationPreferenceLeaves(previous, value),
      );

      return value;
    });
  }, []);

  const openLoginForProvider = useCallback((provider: AgentProvider) => {
    // Named explicitly rather than left as whatever the last flow set: opening an account login after
    // a design one has to put the modal back on the account command.
    setLoginFlow('account');
    setLoginProvider(provider);
    setShowLoginModal(true);
  }, []);

  /**
   * Opens the same embedded terminal on Claude Design's own authorization (`/design-login`), which the
   * DesignSync tool asks the user to run interactively. Claude is pinned because the command is Claude's
   * slash command, not a provider-independent one.
   */
  const openDesignLogin = useCallback(() => {
    setLoginFlow('design');
    setLoginProvider('claude');
    setShowLoginModal(true);
  }, []);

  /**
   * The only way the modal closes. Resetting the flow here, and not on the next open, is what keeps the
   * modal from being remounted on the account command while the design one is still selected — the
   * command is read off the flow at render time.
   */
  const closeLoginModal = useCallback(() => {
    setShowLoginModal(false);
    setLoginFlow('account');
  }, []);

  const handleLoginComplete = useCallback((exitCode: number) => {
    if (!loginProvider) {
      return;
    }

    // A design authorization authenticates nothing this screen reports on: it is a second, separate
    // claude.ai grant for design-system projects, and the account's own credential is exactly where it
    // was. Re-reading the auth status would re-answer a question that did not change, and the one save
    // banner below would announce a sign-in that never happened — so this flow ends silently, which is
    // also why it is decided here rather than by leaving the callback off the modal.
    if (loginFlow === 'design') {
      return;
    }

    void (async () => {
      const authStatus = await checkProviderAuthStatus(loginProvider);

      if (exitCode !== 0) {
        console.warn(`Login process exited with code ${exitCode}; refreshing auth status before setting save status.`);
      }

      setSaveStatus(authStatus.authenticated ? 'success' : 'error');
    })();
  }, [checkProviderAuthStatus, loginFlow, loginProvider]);

  const saveSettings = useCallback(async () => {
    const stores = toAutosavedStores({
      claudePermissions,
      projectSortOrder,
      cursorPermissions,
      codexPermissions: { permissionMode: codexPermissionMode },
    });
    const storesSignature = autosavedStoresSignature(stores);
    // A null baseline is "never read", so nothing here can be called a change — writing is what a
    // section does once somebody has read it, or, for a switch the user moved themselves, once the
    // read below has produced the truth to lay that switch over.
    const storesChanged = syncedStoresSignature !== null && syncedStoresSignature !== storesSignature;

    const leaves = editedNotificationLeavesRef.current;
    const storedPreferences = overlayNotificationLeaves(notificationPreferences, leaves);
    const notificationsChanged = syncedNotificationsSignature === null
      ? hasNotificationPreferenceLeaves(leaves)
      : syncedNotificationsSignature !== notificationPreferencesSignature(storedPreferences);

    // The debounce cannot tell a tap from a load: opening the dialog fetches the notification
    // preferences, and that answer arrives here as a state change like any other, half a second
    // before this runs. Writing then put the payload the dialog had just read back on the wire and
    // announced a save nobody made — on every open, of every session.
    //
    // So each section is judged against what the server last agreed with, and not against what the
    // screen happens to hold: nothing has changed if the values are the ones just loaded, and
    // anything else is a real edit that goes out exactly as before. What a section whose read failed
    // never gets is a change it did not see the user make — that is the difference between an
    // unknown value and a default one, and it is what keeps an unrelated edit from writing the
    // notification preferences away.
    if (!storesChanged && !notificationsChanged) {
      return;
    }

    setSaveStatus(null);

    try {
      if (storesChanged) {
        // One call so the store half of the dialog reaches the server as a single
        // merge-patch rather than four racing requests.
        // `permissionMode` is spread in only when it has a value: writing the key
        // as undefined would erase an edit mode the composer had just set.
        writeUserPreferences({
          claudePermissions: stores.claudePermissions,
          projectSortOrder: stores.projectSortOrder,
          cursorPermissions: stores.cursorPermissions,
          codexPermissions: stores.codexPermissions,
        });
        setSyncedStoresSignature(storesSignature);
      }

      if (notificationsChanged) {
        // With nothing read yet — a load whose read failed — the payload cannot be the one on
        // screen: its untouched switches are placeholders, and writing those would reset every
        // preference the user never saw. So the truth is read now and the user's own taps are laid
        // over it, which is the same merge a successful load does, one step later. Paid for only
        // in the case where the answer is genuinely missing.
        let payload = storedPreferences;
        if (syncedNotificationsSignature === null) {
          const serverPreferences = await readServerNotificationPreferences();
          if (serverPreferences === null) {
            throw new Error('Notification preferences are unknown and could not be read');
          }
          payload = overlayNotificationLeaves(serverPreferences, leaves);
        }

        const notificationResponse = await api.settings.saveNotificationPreferences(payload);
        if (!notificationResponse.ok) {
          throw new Error('Failed to save notification preferences');
        }

        // What the server now holds is the merge, so the dialog shows it and both the leaves and the
        // baseline move to it together — the next change is measured from the value that landed.
        editedNotificationLeavesRef.current = noNotificationPreferenceLeaves();
        if (syncedNotificationsSignature === null) {
          setNotificationPreferences(payload);
        }
        setSyncedNotificationsSignature(notificationPreferencesSignature(payload));
      }

      setSaveStatus('success');
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveStatus('error');
    }
    // Whole stores, not the fields inside them: the payload this writes is built by
    // `toAutosavedStores`, so naming fields here would be a second, silently incomplete copy of
    // that function's own list — and a field left off it is a control whose change never re-runs
    // the effect keyed on `[saveSettings]`, which is to say a control that does nothing. The
    // stores themselves are replaced wholesale and never mutated, so an edit is exactly an
    // identity change here. The two baselines are listed for the same reason: a read that learns
    // the truth must reach that effect, or the edit measured against it is never written.
  }, [
    claudePermissions,
    codexPermissionMode,
    cursorPermissions,
    notificationPreferences,
    projectSortOrder,
    syncedNotificationsSignature,
    syncedStoresSignature,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab(normalizeMainTab(initialTab));
    void loadSettings();
    void refreshProviderAuthStatuses();
  }, [initialTab, isOpen, loadSettings, refreshProviderAuthStatuses]);

  useEffect(() => {
    setNotificationSoundEnabled(notificationPreferences.channels.sound);
  }, [notificationPreferences.channels.sound]);

  // Auto-save permissions and sort order with debounce
  const autoSaveTimerRef = useRef<number | null>(null);

  // Read by the unmount flush below, which must call the NEWEST saver rather than
  // the one that happened to be current when the dialog opened.
  const saveSettingsRef = useRef(saveSettings);
  useEffect(() => {
    saveSettingsRef.current = saveSettings;
  }, [saveSettings]);

  // Armed on every change, a load's own answer included, and left to the save to decide what is
  // real: an answer from the server changes nothing a signature can see, so the save it wakes
  // returns without writing. Holding the timer back until the dialog was hydrated is what turned
  // the flush below into a trap — the flush reads this ref to decide whether anything is pending,
  // and a ref that was never armed says "nothing", so an edit made during a slow load died with
  // the close that followed it.
  useEffect(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    // Nulled when it fires, so `autoSaveTimerRef.current !== null` means exactly
    // "a change is still waiting to be written" — which is what the flush below
    // has to be able to ask.
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      saveSettings();
    }, 500);

    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [saveSettings]);

  // A pending write must not die with the dialog. Changing something and closing
  // within half a second is the ordinary way to use this screen, and the cleanup
  // above cancels the timer on unmount — so that write was simply lost, and the
  // control that made it looked inert. Declared AFTER the debounce effect so its
  // cleanup runs second, when the timer has been cancelled but the ref still says
  // a change was waiting.
  useEffect(() => () => {
    if (autoSaveTimerRef.current === null) {
      return;
    }
    autoSaveTimerRef.current = null;
    void saveSettingsRef.current();
  }, []);

  // Clear save status after 2 seconds
  useEffect(() => {
    if (saveStatus === null) {
      return;
    }

    const timer = window.setTimeout(() => setSaveStatus(null), 2000);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  return {
    activeTab,
    setActiveTab,
    isDarkMode,
    toggleDarkMode,
    saveStatus,
    projectSortOrder,
    setProjectSortOrder,
    claudePermissions,
    setClaudePermissions,
    cursorPermissions,
    setCursorPermissions,
    notificationPreferences,
    setNotificationPreferences: updateNotificationPreferences,
    codexPermissionMode,
    setCodexPermissionMode,
    providerAuthStatus,
    openLoginForProvider,
    openDesignLogin,
    closeLoginModal,
    showLoginModal,
    loginProvider,
    loginFlow,
    handleLoginComplete,
  };
}
