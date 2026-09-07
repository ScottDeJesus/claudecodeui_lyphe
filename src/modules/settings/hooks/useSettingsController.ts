import { useCallback, useEffect, useRef, useState } from 'react';

import { useTheme } from '@/shared/context/ThemeContext';
import { api } from '@/shared/api';
import { setNotificationSoundEnabled } from '@/shared/utils';
import {
  readUserPreference,
  writeUserPreferences,
} from '@/shared/userSettings';
import { useProviderAuthStatus } from '@/modules/provider-auth';
import type { AgentProvider, ClaudePermissionsState, CodexPermissionMode, CursorPermissionsState, NotificationPreferencesState, PermissionMode, ProjectSortOrder, SettingsMainTab } from '@/shared/types';

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

// `permissionMode` is the edit mode, and it is the ONE store the chat composer
// writes to as well (useChatProviderState). It is declared on all three so a save
// from this dialog carries the composer's choice back out instead of dropping it.
type ClaudeSettingsStorage = {
  allowedTools?: string[];
  disallowedTools?: string[];
  skipPermissions?: boolean;
  projectSortOrder?: ProjectSortOrder;
  permissionMode?: PermissionMode;
};

type CursorSettingsStorage = {
  allowedCommands?: string[];
  disallowedCommands?: string[];
  skipPermissions?: boolean;
  permissionMode?: PermissionMode;
};

type CodexSettingsStorage = {
  permissionMode?: CodexPermissionMode;
};

type NotificationPreferencesResponse = {
  success?: boolean;
  preferences?: NotificationPreferencesState;
};

type ActiveLoginProvider = AgentProvider | '';

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

const createEmptyClaudePermissions = (): ClaudePermissionsState => ({
  allowedTools: [],
  disallowedTools: [],
  skipPermissions: false,
});

const createEmptyCursorPermissions = (): CursorPermissionsState => ({
  ...DEFAULT_CURSOR_PERMISSIONS,
});

const createDefaultNotificationPreferences = (): NotificationPreferencesState => ({
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
  },
});

const normalizeNotificationPreferences = (
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
    },
  };
};

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

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginProvider, setLoginProvider] = useState<ActiveLoginProvider>('');
  const {
    providerAuthStatus,
    checkProviderAuthStatus,
    refreshProviderAuthStatuses,
  } = useProviderAuthStatus();

  const loadSettings = useCallback(async () => {
    try {
      const savedClaudeSettings = readUserPreference<ClaudeSettingsStorage>('claudePermissions', {});
      setClaudePermissions({
        allowedTools: savedClaudeSettings.allowedTools || [],
        disallowedTools: savedClaudeSettings.disallowedTools || [],
        skipPermissions: Boolean(savedClaudeSettings.skipPermissions),
        permissionMode: savedClaudeSettings.permissionMode,
      });
      setProjectSortOrder(readUserPreference<ProjectSortOrder>('projectSortOrder', 'name') === 'date' ? 'date' : 'name');

      const savedCursorSettings = readUserPreference<CursorSettingsStorage>('cursorPermissions', {});
      setCursorPermissions({
        allowedCommands: savedCursorSettings.allowedCommands || [],
        disallowedCommands: savedCursorSettings.disallowedCommands || [],
        skipPermissions: Boolean(savedCursorSettings.skipPermissions),
        permissionMode: savedCursorSettings.permissionMode,
      });

      const savedCodexSettings = readUserPreference<CodexSettingsStorage>('codexPermissions', {});
      setCodexPermissionMode(toCodexPermissionMode(savedCodexSettings.permissionMode));

      try {
        const notificationResponse = await api.settings.notificationPreferences();
        if (notificationResponse.ok) {
          const notificationData = await toResponseJson<NotificationPreferencesResponse>(notificationResponse);
          if (notificationData.success && notificationData.preferences) {
            setNotificationPreferences(normalizeNotificationPreferences(notificationData.preferences));
          } else {
            setNotificationPreferences(createDefaultNotificationPreferences());
          }
        } else {
          setNotificationPreferences(createDefaultNotificationPreferences());
        }
      } catch {
        setNotificationPreferences(createDefaultNotificationPreferences());
      }

    } catch (error) {
      console.error('Error loading settings:', error);
      setClaudePermissions(createEmptyClaudePermissions());
      setCursorPermissions(createEmptyCursorPermissions());
      setNotificationPreferences(createDefaultNotificationPreferences());
      setCodexPermissionMode('default');
      setProjectSortOrder('name');
    }
  }, []);

  const openLoginForProvider = useCallback((provider: AgentProvider) => {
    setLoginProvider(provider);
    setShowLoginModal(true);
  }, []);

  const handleLoginComplete = useCallback((exitCode: number) => {
    if (!loginProvider) {
      return;
    }

    void (async () => {
      const authStatus = await checkProviderAuthStatus(loginProvider);

      if (exitCode !== 0) {
        console.warn(`Login process exited with code ${exitCode}; refreshing auth status before setting save status.`);
      }

      setSaveStatus(authStatus.authenticated ? 'success' : 'error');
    })();
  }, [checkProviderAuthStatus, loginProvider]);

  const saveSettings = useCallback(async () => {
    setSaveStatus(null);

    try {
      // One call so the whole dialog's state reaches the server as a single
      // merge-patch rather than four racing requests.
      // `permissionMode` is spread in only when it has a value: this dialog
      // auto-saves the moment it opens, and writing the key as undefined would
      // erase an edit mode the composer had just set.
      writeUserPreferences({
        claudePermissions: {
          allowedTools: claudePermissions.allowedTools,
          disallowedTools: claudePermissions.disallowedTools,
          skipPermissions: claudePermissions.skipPermissions,
          ...(claudePermissions.permissionMode ? { permissionMode: claudePermissions.permissionMode } : {}),
        },
        projectSortOrder,
        cursorPermissions: {
          allowedCommands: cursorPermissions.allowedCommands,
          disallowedCommands: cursorPermissions.disallowedCommands,
          skipPermissions: cursorPermissions.skipPermissions,
          ...(cursorPermissions.permissionMode ? { permissionMode: cursorPermissions.permissionMode } : {}),
        },
        codexPermissions: {
          permissionMode: codexPermissionMode,
        },
      });

      const notificationResponse = await api.settings.saveNotificationPreferences(
        notificationPreferences,
      );
      if (!notificationResponse.ok) {
        throw new Error('Failed to save notification preferences');
      }

      setSaveStatus('success');
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveStatus('error');
    }
    // Field-by-field, not the whole state object — but then EVERY field this
    // function writes has to be listed, or the auto-save effect keyed on
    // `[saveSettings]` never re-runs for the one that was missed and the control
    // that changed it is silently inert.
  }, [
    claudePermissions.allowedTools,
    claudePermissions.disallowedTools,
    claudePermissions.permissionMode,
    claudePermissions.skipPermissions,
    codexPermissionMode,
    cursorPermissions.allowedCommands,
    cursorPermissions.disallowedCommands,
    cursorPermissions.permissionMode,
    cursorPermissions.skipPermissions,
    notificationPreferences,
    projectSortOrder,
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
  const isInitialLoadRef = useRef(true);

  // Read by the unmount flush below, which must call the NEWEST saver rather than
  // the one that happened to be current when the dialog opened.
  const saveSettingsRef = useRef(saveSettings);
  useEffect(() => {
    saveSettingsRef.current = saveSettings;
  }, [saveSettings]);

  useEffect(() => {
    // Skip auto-save on initial load (settings are being loaded from the store)
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return;
    }

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

  // Reset initial load flag when settings dialog opens
  useEffect(() => {
    if (isOpen) {
      isInitialLoadRef.current = true;
    }
  }, [isOpen]);

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
    setNotificationPreferences,
    codexPermissionMode,
    setCodexPermissionMode,
    providerAuthStatus,
    openLoginForProvider,
    showLoginModal,
    setShowLoginModal,
    loginProvider,
    handleLoginComplete,
  };
}
