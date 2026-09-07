import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import '@xterm/xterm/css/xterm.css';
import type { Project, ProjectSession } from '@/shared/types';
import { useShellRuntime } from '@/modules/shell/hooks/useShellRuntime';
import { sendSocketMessage } from '@/modules/shell/utils/socket';
import { getSessionTitle } from '@/shared/utils';
import { readSelectedProvider } from '@/shared/selectedProvider';
import { getClaudeSettings } from '@/modules/chat';
import { readShellConnection, readShellMeta } from '@/modules/shell/shellHeaderFacts';
import ShellConnectionOverlay from '@/modules/shell/ShellConnectionOverlay';
import ShellEmptyState from '@/modules/shell/ShellEmptyState';
import ShellHeader from '@/modules/shell/ShellHeader';
import ShellMinimalView from '@/modules/shell/ShellMinimalView';
import TerminalShortcutsPanel from '@/modules/shell/TerminalShortcutsPanel';

const SHELL_RESTART_DELAY_MS = 200;

// CLI prompt overlay detection
const PROMPT_DEBOUNCE_MS = 500;
const PROMPT_BUFFER_SCAN_LINES = 20;
const PROMPT_OPTION_SCAN_LINES = 15;
const PROMPT_MAX_OPTIONS = 5;
const PROMPT_MIN_OPTIONS = 2;

type CliPromptOption = { number: string; label: string };

type ShellProps = {
  selectedProject?: Project | null;
  selectedSession?: ProjectSession | null;
  initialCommand?: string | null;
  isPlainShell?: boolean;
  onProcessComplete?: ((exitCode: number) => void) | null;
  minimal?: boolean;
  autoConnect?: boolean;
  isActive?: boolean;
};

/** Exported through the shell barrel: the standalone-shell module renders it as a full-page terminal and the task-master module embeds it in its setup modal to run TaskMaster's init command. */
export default function Shell({
  selectedProject = null,
  selectedSession = null,
  initialCommand = null,
  isPlainShell = false,
  onProcessComplete = null,
  minimal = false,
  autoConnect = false,
  isActive = true,
}: ShellProps) {
  const { t } = useTranslation('chat');
  const [isRestarting, setIsRestarting] = useState(false);
  // Seeded from the chat composer's persisted permission setting; the header
  // toggle only changes this shell's launches, not the chat setting.
  const [bypassPermissions, setBypassPermissions] = useState(
    () => getClaudeSettings().skipPermissions,
  );
  const [cliPromptOptions, setCliPromptOptions] = useState<CliPromptOption[] | null>(null);
  // When this session actually came up. Nothing in the socket protocol carries a start time,
  // so the moment the connection opened is the only honest one the header can state — and it
  // is cleared on disconnect, so the header never dates a session that has ended.
  const [connectedAt, setConnectedAt] = useState<Date | null>(null);
  // Whether the reader has asked for the shortcut key strip on a desktop width, where it is
  // otherwise hidden. It is a request, not a fact about the terminal, so it lives here rather
  // than being derived from the connection.
  const [showShortcutsOnDesktop, setShowShortcutsOnDesktop] = useState(false);
  const promptCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartAfterInitRef = useRef(false);
  const onOutputRef = useRef<(() => void) | null>(null);

  const {
    terminalContainerRef,
    terminalRef,
    wsRef,
    isConnected,
    isInitialized,
    isConnecting,
    connectToShell,
    disconnectFromShell,
  } = useShellRuntime({
    selectedProject,
    selectedSession,
    initialCommand,
    isPlainShell,
    bypassPermissions,
    minimal,
    autoConnect,
    isRestarting,
    onProcessComplete,
    onOutputRef,
  });

  // Check xterm.js buffer for CLI prompt patterns (❯ N. label)
  const checkBufferForPrompt = useCallback(() => {
    const term = terminalRef.current;
    if (!term) return;
    const buf = term.buffer.active;
    const lastContentRow = buf.baseY + buf.cursorY;
    const scanEnd = Math.min(buf.baseY + buf.length - 1, lastContentRow + 10);
    const scanStart = Math.max(0, lastContentRow - PROMPT_BUFFER_SCAN_LINES);
    const lines: string[] = [];
    for (let i = scanStart; i <= scanEnd; i++) {
      const line = buf.getLine(i);
      if (line) lines.push(line.translateToString().trimEnd());
    }

    let footerIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/esc to cancel/i.test(lines[i]) || /enter to select/i.test(lines[i])) {
        footerIdx = i;
        break;
      }
    }

    if (footerIdx === -1) {
      setCliPromptOptions(null);
      return;
    }

    // Scan upward from footer collecting numbered options.
    // Non-matching lines are allowed (multi-line labels, blank separators)
    // because CLI prompts may wrap options across multiple terminal rows.
    const optMap = new Map<string, string>();
    const optScanStart = Math.max(0, footerIdx - PROMPT_OPTION_SCAN_LINES);
    for (let i = footerIdx - 1; i >= optScanStart; i--) {
      const match = lines[i].match(/^\s*[❯›>]?\s*(\d+)\.\s+(.+)/);
      if (match) {
        const num = match[1];
        const label = match[2].trim();
        if (parseInt(num, 10) <= PROMPT_MAX_OPTIONS && label.length > 0 && !optMap.has(num)) {
          optMap.set(num, label);
        }
      }
    }

    const valid: CliPromptOption[] = [];
    for (let i = 1; i <= optMap.size; i++) {
      if (optMap.has(String(i))) valid.push({ number: String(i), label: optMap.get(String(i))! });
      else break;
    }

    setCliPromptOptions(valid.length >= PROMPT_MIN_OPTIONS ? valid : null);
  }, [terminalRef]);

  // Schedule prompt check after terminal output (debounced)
  const schedulePromptCheck = useCallback(() => {
    if (promptCheckTimer.current) clearTimeout(promptCheckTimer.current);
    promptCheckTimer.current = setTimeout(checkBufferForPrompt, PROMPT_DEBOUNCE_MS);
  }, [checkBufferForPrompt]);

  // Wire up the onOutput callback
  useEffect(() => {
    onOutputRef.current = schedulePromptCheck;
  }, [schedulePromptCheck]);

  // Cleanup prompt check timer on unmount
  useEffect(() => {
    return () => {
      if (promptCheckTimer.current) clearTimeout(promptCheckTimer.current);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setConnectedAt(isConnected ? new Date() : null);
  }, [isConnected]);

  // Clear stale prompt options and cancel pending timer on disconnect
  useEffect(() => {
    if (!isConnected) {
      if (promptCheckTimer.current) {
        clearTimeout(promptCheckTimer.current);
        promptCheckTimer.current = null;
      }
      setCliPromptOptions(null);
    }
  }, [isConnected]);

  useEffect(() => {
    if (!isActive || !isInitialized || !isConnected) {
      return;
    }

    const focusTerminal = () => {
      terminalRef.current?.focus();
    };

    const animationFrameId = window.requestAnimationFrame(focusTerminal);
    const timeoutId = window.setTimeout(focusTerminal, 0);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
    };
  }, [isActive, isConnected, isInitialized, terminalRef]);

  const sendInput = useCallback(
    (data: string) => {
      sendSocketMessage(wsRef.current, { type: 'input', data });
    },
    [wsRef],
  );

  // Null (not a label) when nothing is selected, which is what the header renders against.
  const sessionDisplayName = useMemo(
    () => (selectedSession ? getSessionTitle(selectedSession) : null),
    [selectedSession],
  );
  const sessionDisplayNameShort = useMemo(
    () => (sessionDisplayName ? sessionDisplayName.slice(0, 30) : null),
    [sessionDisplayName],
  );
  const sessionDisplayNameLong = useMemo(
    () => (sessionDisplayName ? sessionDisplayName.slice(0, 50) : null),
    [sessionDisplayName],
  );

  const handleRestartShell = useCallback(() => {
    restartAfterInitRef.current = true;
    setIsRestarting(true);
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
    }
    restartTimerRef.current = setTimeout(() => {
      setIsRestarting(false);
      restartTimerRef.current = null;
    }, SHELL_RESTART_DELAY_MS);
  }, []);

  const shellProvider = isPlainShell
    ? 'plain-shell'
    : selectedSession?.__provider || readSelectedProvider();

  const handleToggleBypassPermissions = useCallback(() => {
    setBypassPermissions((enabled) => !enabled);
    // The flag only applies at launch, so a running CLI must be restarted.
    if (isConnected) {
      handleRestartShell();
    }
  }, [handleRestartShell, isConnected]);

  const handleDisconnectShell = useCallback(() => {
    restartAfterInitRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    setIsRestarting(false);
    disconnectFromShell({ suppressAutoConnect: true });
  }, [disconnectFromShell]);

  useEffect(() => {
    if (
      !restartAfterInitRef.current ||
      isRestarting ||
      !isInitialized ||
      isConnected ||
      isConnecting
    ) {
      return;
    }

    restartAfterInitRef.current = false;
    connectToShell({ forceRestart: true });
  }, [connectToShell, isConnected, isConnecting, isInitialized, isRestarting]);

  if (!selectedProject) {
    return (
      <ShellEmptyState
        title={t('shell.selectProject.title')}
        description={t('shell.selectProject.description')}
      />
    );
  }

  if (minimal) {
    return (
      <ShellMinimalView terminalContainerRef={terminalContainerRef}>
        <TerminalShortcutsPanel wsRef={wsRef} terminalRef={terminalRef} isConnected={isConnected} />
      </ShellMinimalView>
    );
  }

  const readyDescription = isPlainShell
    ? t('shell.runCommand', {
        command: initialCommand || t('shell.defaultCommand'),
        projectName: selectedProject.displayName,
      })
    : selectedSession
      ? t('shell.resumeSession', { displayName: sessionDisplayNameLong })
      : t('shell.startSession');

  const connectingDescription = isPlainShell
    ? t('shell.runCommand', {
        command: initialCommand || t('shell.defaultCommand'),
        projectName: selectedProject.displayName,
      })
    : t('shell.startCli', { projectName: selectedProject.displayName });

  const overlayMode = !isInitialized ? 'loading' : isConnecting ? 'connecting' : !isConnected ? 'connect' : null;
  const overlayDescription = overlayMode === 'connecting' ? connectingDescription : readyDescription;

  const connection = readShellConnection({ isRestarting, isInitialized, isConnected }, t);
  const meta = readShellMeta(
    {
      project: selectedProject,
      isPlainShell,
      initialCommand,
      sessionName: sessionDisplayNameShort,
      connectedAt,
    },
    t,
  );

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <ShellHeader
        connectionTone={connection.tone}
        connectionLabel={connection.label}
        meta={meta}
        shortcutsLabel={t('shell.actions.shortcuts')}
        shortcutsShown={showShortcutsOnDesktop}
        onToggleShortcuts={() => setShowShortcutsOnDesktop((shown) => !shown)}
        showDisconnect={isConnected}
        onDisconnect={handleDisconnectShell}
        onRestart={handleRestartShell}
        disconnectLabel={t('shell.actions.disconnect')}
        disconnectTitle={t('shell.actions.disconnectTitle')}
        restartLabel={t('shell.actions.restart')}
        restartTitle={t('shell.actions.restartTitle')}
        disableRestart={isRestarting || !isInitialized}
        showBypassToggle={shellProvider === 'claude'}
        bypassEnabled={bypassPermissions}
        onToggleBypass={handleToggleBypassPermissions}
        bypassLabel={t('shell.actions.bypass')}
        bypassTitle={t(
          bypassPermissions ? 'shell.actions.bypassOnTitle' : 'shell.actions.bypassOffTitle',
        )}
      />

      <div className="relative mx-3 mt-3 flex-1 overflow-hidden rounded-xl border border-border bg-secondary p-3">
        <div
          ref={terminalContainerRef}
          className="h-full w-full focus:outline-none"
          style={{ outline: 'none' }}
        />

        {overlayMode && (
          <ShellConnectionOverlay
            mode={overlayMode}
            description={overlayDescription}
            loadingLabel={t('shell.loading')}
            connectLabel={t('shell.actions.connect')}
            connectTitle={t('shell.actions.connectTitle')}
            connectingLabel={t('shell.connecting')}
            onConnect={handleRestartShell}
          />
        )}

        {cliPromptOptions && isConnected && (
          <div
            className="absolute inset-x-0 bottom-0 z-10 border-t border-border bg-popover/95 px-3 py-2 backdrop-blur-sm md:hidden"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="flex flex-wrap items-center gap-2">
              {cliPromptOptions.map((opt) => (
                <button
                  type="button"
                  key={opt.number}
                  onClick={() => {
                    sendInput(opt.number);
                    setCliPromptOptions(null);
                  }}
                  className="max-w-36 truncate rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors"
                  title={`${opt.number}. ${opt.label}`}
                >
                  {opt.number}. {opt.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  sendInput('\x1b');
                  setCliPromptOptions(null);
                }}
                className="rounded border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors"
              >
                Esc
              </button>
            </div>
          </div>
        )}

        <TerminalShortcutsPanel
          wsRef={wsRef}
          terminalRef={terminalRef}
          isConnected={isConnected}
          showOnDesktop={showShortcutsOnDesktop}
        />
      </div>

      <p className="flex-none px-4 py-2.5 text-xs text-ink-faint">{t('shell.privacyNote')}</p>
    </div>
  );
}
