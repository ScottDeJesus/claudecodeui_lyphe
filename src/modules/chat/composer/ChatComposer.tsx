import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  TouchEvent,
} from 'react';
import { PlusIcon, PencilRulerIcon, XIcon, Loader2, ArrowUpIcon, PencilIcon } from 'lucide-react';

import { PAGE_ANCHOR } from '@/shared/constants';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { useAwaitingInputSessionIdSet } from '@/shared/context/SessionProtectionContext';
import { usePageAnchor } from '@/shared/context/PageAnchorsContext';
import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import {
  Chip,
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from '@/shared/ui';
import { useVoiceInput } from '@/modules/chat/hooks/useVoiceInput';
import { useVoiceAvailable } from '@/modules/chat/hooks/useVoiceAvailable';
import type { PendingSteer, QueuedDraft, ScheduledMessage, SlashCommand,SessionActivity,PendingPermissionRequest,PermissionMode,ProviderModelOption } from '@/shared/types';
import CommandMenu from '@/modules/chat/composer/CommandMenu';
import ActivityIndicator from '@/modules/chat/composer/ActivityIndicator';
import { ComposerAttachmentTray } from '@/modules/chat/composer/ComposerAttachmentTray';
import { ComposerDropOverlay } from '@/modules/chat/composer/ComposerDropOverlay';
import VoiceInputButton from '@/modules/chat/composer/VoiceInputButton';
import PermissionRequestsBanner from '@/modules/chat/composer/PermissionRequestsBanner';
import TokenUsageSummary from '@/modules/chat/composer/TokenUsageSummary';
import QueuedMessageCard from '@/modules/chat/composer/QueuedMessageCard';
import SteeredMessageCard from '@/modules/chat/composer/SteeredMessageCard';
import { SendMenuPopover } from '@/modules/chat/composer/SendMenuPopover';
import type { SendMenuChoice } from '@/modules/chat/composer/SendMenuPopover';
import { ScheduleMessagePopover } from '@/modules/chat/composer/ScheduleMessagePopover';
import { ScheduledMessageList } from '@/modules/chat/composer/ScheduledMessageList';
import { ChatCore } from '@/modules/chat/composer/ChatCore';
import ComposerDeepSeekSwitch from '@/modules/chat/composer/ComposerDeepSeekSwitch';
import ComposerModelMenu from '@/modules/chat/composer/ComposerModelMenu';
import ComposerPermissionMenu from '@/modules/chat/composer/ComposerPermissionMenu';
import type { SessionToolsetsState } from '@/modules/chat/hooks/useSessionToolsets';
import ChatExportMenu, { type ChatExportSurface } from '@/modules/chat/transcript/ChatExportMenu';

type MentionableFile = {
  name: string;
  path: string;
};

// A stable empty default, so a composer with no steered messages does not get a new array each render.
const NO_PENDING_STEERS: PendingSteer[] = [];

type ChatComposerProps = {
  /** The chat this composer writes into, or null before it has one: the key its input box is registered under as a page anchor. */
  sessionId: string | null;
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  activity: SessionActivity | null;
  isLoading: boolean;
  onAbortSession: () => void;
  permissionMode: PermissionMode;
  availablePermissionModes: PermissionMode[];
  onSelectPermissionMode: (mode: PermissionMode) => void;
  effort: string;
  availableEffortOptions: NonNullable<ProviderModelOption['effort']>['values'];
  onSelectEffort: (effort: string) => void;
  model: string;
  availableModelOptions: ProviderModelOption[];
  availableModelLabelsById?: Record<string, string>;
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
  /** The open chat's tool sets, handed on to the model menu. Hold its identity between reads: the menu is memoized on it. */
  toolsets: SessionToolsetsState;
  tokenBudget: Record<string, unknown> | null;
  onShowTokenUsage: () => void;
  onToggleCommandMenu: () => void;
  /**
   * The pinned-agents strip, seated at the top of this shell so it sits between the
   * transcript and the input: the transcript's scroller ends above it, so the last message
   * is never under it, and the activity tab still floats above it as it floats above the
   * transcript today. The composer knows nothing about agents; it only holds the seat.
   */
  /**
   * What an export needs, or `null` while there is nothing to export. Drawn here from `md` up —
   * beside the model and the edit mode, where the conversation's own controls are — and by the
   * workspace header below that width, which is the one surface a phone has room for.
   */
  exportSurface?: ChatExportSurface | null;
  pinnedAgents?: ReactNode;
  /** Every message goes out under `/plain` while this is on. */
  plainMode: boolean;
  onTogglePlainMode: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  queuedDraft: QueuedDraft | null;
  /** Set while the composer is replacing an already-sent message. */
  isEditingSentMessage: boolean;
  onCancelEditMessage: () => void;
  /** Messages waiting to be sent to this session later. */
  scheduledMessages: ScheduledMessage[];
  onScheduleMessage: (scheduledFor: Date) => void;
  onCancelScheduledMessage: (id: string) => void;
  onEditQueuedDraft: () => void;
  onDeleteQueuedDraft: () => void;
  /** Whether the provider can take a message into a running turn; gates the send button's hold-menu while a turn runs. False until the capability matrix has loaded, or for a provider it does not list. */
  supportsSteering?: boolean;
  /** Handles the hold-menu's choice: queue the typed message for after the turn, or steer it into the turn. */
  onSendMenuChoice?: (choice: SendMenuChoice) => void;
  /** Messages sent into the running turn that the agent has not read yet, each shown as a card above the composer until its echo lands in the transcript. */
  pendingSteers?: PendingSteer[];
  /** The provider's display name, for the steer card's sentence. */
  providerLabel: string;
  attachedFiles: File[];
  onRemoveAttachment: (index: number) => void;
  /** The sentence for the files the last intake did not take; null when it took them all. */
  refused: string | null;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openAttachmentPicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  onVoiceTranscript?: (text: string, send?: boolean) => void;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  isInputFocused?: boolean;
  onInputFocusChange?: (focused: boolean) => void;
  placeholder: string;
  isTextareaExpanded: boolean;
};

/**
 * How long a press on send has to last before it means "later" instead of "now".
 *
 * 500ms is the platform convention for a long press (Android's own default), and it is far
 * enough past a deliberate tap that a fast one never trips it.
 */
const LONG_PRESS_MS = 500;

/**
 * Rendered by chat's ChatInterface as the whole input area: textarea, pending
 * attachments, queued message, permission banner, voice input and the
 * model/permission popovers that drive the next turn.
 */
export default function ChatComposer({
  sessionId,
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  activity,
  isLoading,
  onAbortSession,
  permissionMode,
  availablePermissionModes,
  onSelectPermissionMode,
  effort,
  availableEffortOptions,
  onSelectEffort,
  model,
  availableModelOptions,
  availableModelLabelsById,
  onSelectModel,
  modelsLoading,
  toolsets,
  tokenBudget,
  onShowTokenUsage,
  onToggleCommandMenu,
  exportSurface,
  pinnedAgents,
  plainMode,
  onTogglePlainMode,
  hasInput,
  onClearInput,
  onSubmit,
  isDragActive,
  queuedDraft,
  isEditingSentMessage,
  onCancelEditMessage,
  scheduledMessages,
  onScheduleMessage,
  onCancelScheduledMessage,
  onEditQueuedDraft,
  onDeleteQueuedDraft,
  supportsSteering = false,
  onSendMenuChoice,
  pendingSteers = NO_PENDING_STEERS,
  providerLabel,
  attachedFiles,
  onRemoveAttachment,
  refused,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openAttachmentPicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  onVoiceTranscript,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  isInputFocused = false,
  onInputFocusChange,
  placeholder,
  isTextareaExpanded,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  // The input box is an anchor a floating guide can point at while this chat is the one being drafted for. A composer with no chat yet registers nothing.
  const anchorRef = usePageAnchor(sessionId === null ? null : PAGE_ANCHOR.composer(sessionId));
  // 640px is Tailwind's `sm`, which is the breakpoint every other rule in this footer reads.
  // Below it the model menu carries the edit mode and the permission chip is not rendered at
  // all — a CSS-hidden second chip would still mount a second popover for the same choice.
  const { isMobile: isNarrowComposer } = useDeviceSettings({ mobileBreakpoint: 640, trackPWA: false });

  // Send-later hangs off a press-and-hold on the SEND button; it has no button of its own.
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  // The same hold, while a turn is running: it opens the Queue / Steer menu instead. Owned here for the same
  // reason as the schedule panel's — this composer owns the button.
  const [isSendMenuOpen, setIsSendMenuOpen] = useState(false);
  // The window the composer is drawn in: the command menu is placed against ITS viewport, and the
  // send button's hold is timed on it (a hidden opener throttles its timers).
  const hostWindow = useHostWindow();
  // The hold timer and the window that armed it: a timer id means something only to the window that
  // issued it, so a cancel after a move still clears it there.
  const longPressTimerRef = useRef<{ id: number; armedOn: Window } | null>(null);
  // Set the moment the hold fires, and read by the click that a hold always produces afterwards
  // — without it, holding to schedule would ALSO send the message on release.
  const longPressFiredRef = useRef(false);
  const closeSchedule = useCallback(() => setIsScheduleOpen(false), []);
  const closeSendMenu = useCallback(() => setIsSendMenuOpen(false), []);
  const getSendButton = useCallback(() => sendButtonRef.current, []);
  const fileDropdownRef = useRef<HTMLDivElement | null>(null);
  const selectedFileRef = useRef<HTMLDivElement | null>(null);
  const commandMenuPosition = useMemo(() => {
    if (!isCommandMenuOpen) {
      return { top: 0, left: 16, bottom: 90 };
    }
    const textareaRect = textareaRef.current?.getBoundingClientRect();
    return {
      top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
      left: textareaRect ? textareaRect.left : 16,
      bottom: textareaRect ? hostWindow.innerHeight - textareaRect.top + 8 : 90,
    };
  }, [isCommandMenuOpen, textareaRef, hostWindow]);

  useEffect(() => {
    const dropdown = fileDropdownRef.current;
    const selectedFile = selectedFileRef.current;
    if (!showFileDropdown || !dropdown || !selectedFile) {
      return;
    }

    const itemTop = selectedFile.offsetTop;
    const itemBottom = itemTop + selectedFile.offsetHeight;
    const visibleTop = dropdown.scrollTop;
    const visibleBottom = visibleTop + dropdown.clientHeight;

    if (itemTop < visibleTop) {
      dropdown.scrollTop = itemTop;
    } else if (itemBottom > visibleBottom) {
      dropdown.scrollTop = itemBottom - dropdown.clientHeight;
    }
  }, [selectedFileIndex, showFileDropdown]);

  // Voice state is hosted here (not in the mic button) so the main Send button can stop
  // recording and send the transcript in one tap, the way the mic button drops it in the box.
  const voiceAvailable = useVoiceAvailable('dictate');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const handleVoiceError = useCallback((msg: string) => setVoiceError(msg), []);
  // The notice clears itself. An effect keyed on the window, not a timer armed once in the handler: a
  // timer armed on a floating window dies with that window, and chat-host closes the window to bring
  // the chat home — the notice would then stay until the next error. A move changes `hostWindow`, so
  // the effect re-arms on the window the composer now stands in.
  useEffect(() => {
    if (voiceError === null) return;
    const timer = hostWindow.setTimeout(() => setVoiceError(null), 4000);
    return () => hostWindow.clearTimeout(timer);
  }, [voiceError, hostWindow]);
  const noopTranscript = useCallback(() => {}, []);
  const { state: voiceState, toggle: voiceToggle, stop: voiceStop } = useVoiceInput(
    onVoiceTranscript ?? noopTranscript,
    handleVoiceError,
  );
  const isRecording = voiceState === 'recording';
  const isTranscribing = voiceState === 'transcribing';
  // Named because TWO things in the footer turn on it: the mic is rendered by it, and the
  // DeepSeek chip stands down on a narrow row by it. The row's room is decided by what the row
  // actually holds, so the chip asks this question rather than assuming the mic is always here —
  // an account with voice off has no mic, and on that phone the chip's 36px are free.
  const voiceShown = Boolean(onVoiceTranscript && voiceAvailable);

  // A hold is only an alternate for SEND. While a turn is running the button means stop, while
  // a recording is live it means finish, and with nothing typed there is nothing to schedule —
  // in each case holding must do nothing rather than open a menu that cannot act.
  const canScheduleFromSend = !isLoading && !isRecording && !isTranscribing && input.trim().length > 0;

  // While a turn is running, a typed message can be queued for after it (a tap on send) or sent into it. A
  // slash command is a turn of its own and always waits, so it is offered no steering.
  const canQueueDraft = isLoading && Boolean(input.trim() || attachedFiles.length > 0);
  const canSteerFromSend = canQueueDraft && supportsSteering && !isRecording && !isTranscribing
    && !input.trimStart().startsWith('/');
  const canHoldSend = canScheduleFromSend || canSteerFromSend;
  // A menu taken away under the hand (the text cleared, the turn ended) must not leave its flag standing, or it would
  // come back, with no hold, the next time a message is typed during a turn. Set while rendering, which React re-runs
  // at once (as `Select` does for a picker that turns disabled), so the stale flag is never committed.
  if (isSendMenuOpen && !canSteerFromSend) setIsSendMenuOpen(false);

  const cancelLongPress = useCallback(() => {
    const pending = longPressTimerRef.current;
    if (pending) {
      pending.armedOn.clearTimeout(pending.id);
      longPressTimerRef.current = null;
    }
  }, []);

  const startLongPress = useCallback(() => {
    // Cleared BEFORE the guard, not after it. A hold that opened the menu and then released
    // off the button leaves no click to consume the flag; if the next press could return early
    // without clearing it, that press's click would be swallowed — and by then the button may
    // well mean "stop".
    longPressFiredRef.current = false;
    cancelLongPress();
    if (!canHoldSend) return;
    // Which panel the hold opens is decided when it is pressed, not when it fires.
    const opensSchedule = canScheduleFromSend;
    longPressTimerRef.current = {
      id: hostWindow.setTimeout(() => {
        longPressTimerRef.current = null;
        longPressFiredRef.current = true;
        if (opensSchedule) {
          setIsScheduleOpen(true);
        } else {
          setIsSendMenuOpen(true);
        }
      }, LONG_PRESS_MS),
      armedOn: hostWindow,
    };
  }, [canHoldSend, canScheduleFromSend, cancelLongPress, hostWindow]);

  // A timer left running past unmount would call setState on a dead component.
  useEffect(() => cancelLongPress, [cancelLongPress]);

  // Whether the chat's settings stand open over the line: the core's press opens and closes them. Closed each time the composer mounts,
  // so the line is quiet until they are asked for.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsId = useId();
  // A question of the chat's that waits on the reader (the session protection's own set): with a pending permission, what draws the core in.
  const awaitingInput = useAwaitingInputSessionIdSet().has(sessionId ?? '');
  // How full the context window is, for the core's hairline: what is used of the whole, or null while either is not known.
  const contextUsed = Number(tokenBudget?.used);
  const contextTotal = Number(tokenBudget?.total);
  const contextShare = Number.isFinite(contextUsed) && Number.isFinite(contextTotal) && contextTotal > 0 ? contextUsed / contextTotal : null;

  // Hide the thinking/status bar while any permission request is pending
  const hasPendingPermissions = pendingPermissionRequests.length > 0;
  const hasActivityIndicator = Boolean(activity && !hasPendingPermissions);

  const hasQueuedDraft = Boolean(queuedDraft);
  const submitAriaLabel = canQueueDraft
    ? hasQueuedDraft
      ? t('input.queue.append', { defaultValue: 'Add to queued message' })
      : t('input.queue.sendNext', { defaultValue: 'Queue next message' })
    : isLoading
      ? t('input.stop')
      : t('input.send');

  const sendLabelWithHint = canScheduleFromSend
    ? `${submitAriaLabel} — ${t('schedule.holdHint', { defaultValue: 'hold to send later' })}`
    : canSteerFromSend
      ? `${submitAriaLabel} — ${t('input.steer.holdHint', { defaultValue: 'hold to steer' })}`
      : submitAriaLabel;

  return (
    <div className="chat-composer-shell relative flex-shrink-0 px-2 pb-2 pt-0 sm:px-4 sm:pb-4 md:px-4 md:pb-6">
      {pinnedAgents}
      {/* The activity tab is anchored HERE, not on the shell: it floats above the input and
          below the pinned agents, whose work it does not describe — the tab is this
          conversation's own thinking, and a subagent above it is not thinking. */}
      <div className="relative">
      {/* `w-full`, not the shell-padding calc it had on the shell: this wrapper IS the shell's
          content box, so 100% is already the input's width — the calc took the padding off a
          second time and floated both tabs inside the input's corners (Athena, 2026-09-10). */}
      {!hasPendingPermissions && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 w-full max-w-[54.25rem] -translate-x-1/2 translate-y-px bg-transparent">
          <ActivityIndicator activity={activity} onAbort={onAbortSession} isInputFocused={isInputFocused} />
        </div>
      )}

      <PermissionRequestsBanner
        pendingPermissionRequests={pendingPermissionRequests}
        handlePermissionDecision={handlePermissionDecision}
        handleGrantToolPermission={handleGrantToolPermission}
      />

      <ScheduledMessageList
        scheduledMessages={scheduledMessages}
        onCancel={onCancelScheduledMessage}
      />

      {isEditingSentMessage && (
        <div className="mx-auto mb-2 flex max-w-[54.25rem] items-center gap-2 rounded-xl border border-warn-ink/30 bg-warn-ink/10 px-3 py-2 text-xs text-foreground">
          <PencilIcon className="h-3.5 w-3.5 shrink-0 text-warn-ink" />
          <span className="min-w-0 flex-1">
            {t('composer.editing.title')}
            {' — '}
            <span className="text-muted-foreground">{t('composer.editing.filesNotReverted')}</span>
          </span>
          <button
            type="button"
            onClick={onCancelEditMessage}
            className="shrink-0 rounded-md px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {t('composer.editing.cancel')}
          </button>
        </div>
      )}

      {pendingSteers.map((steer) => (
        <SteeredMessageCard key={steer.messageId} steer={steer} providerLabel={providerLabel} />
      ))}

      {queuedDraft && (
        <QueuedMessageCard
          content={queuedDraft.content}
          attachmentCount={
            queuedDraft.uploadedAttachments?.length ?? queuedDraft.attachments.length
          }
          onEdit={onEditQueuedDraft}
          onDelete={onDeleteQueuedDraft}
        />
      )}

      {/* THE CHAT'S SETTINGS, kept behind its core: what sets the chat up rather than writes to it. The same controls the line's
          own row held, each unchanged; they stand here while the core's press has them open. A query container
          (`[container-type:inline-size]`): the model pill's tool-set count shows only where this row is wide enough to hold it
          (ComposerModelMenu). */}
      {settingsOpen && (
        <div
          id={settingsId}
          data-chat-settings=""
          className="mx-auto mb-2 flex max-w-[54.25rem] flex-wrap items-center gap-1.5 [container-type:inline-size]"
        >
          <ComposerModelMenu
            effort={effort}
            effortOptions={availableEffortOptions}
            onSelectEffort={onSelectEffort}
            model={model}
            modelOptions={availableModelOptions}
            modelLabelsById={availableModelLabelsById}
            onSelectModel={onSelectModel}
            modelsLoading={modelsLoading}
            toolsets={toolsets}
            // One pill or two, never both: below `sm` the model menu carries the edit mode as a third section.
            permissionMode={isNarrowComposer ? permissionMode : undefined}
            permissionModes={isNarrowComposer ? availablePermissionModes : undefined}
            onSelectPermissionMode={isNarrowComposer ? onSelectPermissionMode : undefined}
          />

          {!isNarrowComposer && (
            <ComposerPermissionMenu
              permissionMode={permissionMode}
              permissionModes={availablePermissionModes}
              onSelectPermissionMode={onSelectPermissionMode}
            />
          )}

          {/* A pressed chip, not an icon: the state has to be readable at a glance, and "on" for a mode is a word plus a fill. */}
          <Chip
            size="sm"
            className="h-8"
            selected={plainMode}
            onClick={onTogglePlainMode}
            title={t('input.plainModeTooltip')}
          >
            {t('input.plainMode')}
          </Chip>

          {/* Beside Plain because it is the same kind of thing, a mode the reader flips. It carries its own server read. */}
          <ComposerDeepSeekSwitch yieldsToVoice={false} />

          {/* Crossed tools, not a speech bubble: this opens the SKILLS/commands menu. */}
          <PromptInputButton
            tooltip={{ content: t('input.showAllCommands') }}
            onClick={onToggleCommandMenu}
          >
            <PencilRulerIcon />
          </PromptInputButton>

          <TokenUsageSummary usage={tokenBudget} onClick={onShowTokenUsage} />

          {exportSurface && <ChatExportMenu {...exportSurface} />}
        </div>
      )}

      {/* The line: the chat's core, then the box. The anchor is the box's own column, not the shell: the shell also holds the
          pinned agents' strip and the activity tab, which would carry a guide's centre away from the box she is looking at. */}
      <div className="chat-line mx-auto max-w-[54.25rem]">
        <ChatCore
          model={model}
          modelLabel={availableModelLabelsById?.[model] ?? availableModelOptions.find((option) => option.value === model)?.label ?? model}
          state={hasPendingPermissions || awaitingInput ? 'waiting' : isLoading ? 'working' : 'idle'}
          context={contextShare}
          open={settingsOpen}
          controls={settingsId}
          onToggle={() => setSettingsOpen((open) => !open)}
        />
      <div ref={anchorRef} className="relative min-w-0 flex-1">
        {/* The mic's one line, a refusal's sentence or the note that Gemini stood in for the home server: above the form, never
            inside it. The form clips whatever overflows it, and a sentence that names two transcribers is several lines, whose
            first ones were cut off when this stood over the mic. Left-aligned, where the mic is, and wrapped inside the box's width. */}
        {voiceShown && voiceError !== null && (
          <span className="absolute bottom-full left-0 z-50 mb-2 w-max max-w-[min(24rem,100%)] rounded bg-red-600 px-2 py-1 text-xs text-white shadow-lg">
            {voiceError}
          </span>
        )}
        {showFileDropdown && filteredFiles.length > 0 && (
          <div
            ref={fileDropdownRef}
            className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-xl border border-border/50 bg-card/95 shadow-lg backdrop-blur-md"
          >
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                ref={index === selectedFileIndex ? selectedFileRef : undefined}
                className={`cursor-pointer touch-manipulation border-b border-border/30 px-4 py-3 last:border-b-0 ${
                  index === selectedFileIndex
                    ? 'bg-primary/8 text-primary'
                    : 'text-foreground hover:bg-accent/50'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectFile(file);
                }}
              >
                <div className="text-sm font-medium">{file.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{file.path}</div>
              </div>
            ))}
          </div>
        )}

        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          position={commandMenuPosition}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        <PromptInput
          onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void}
          status={isLoading ? 'streaming' : 'ready'}
          className={[
            isTextareaExpanded ? 'chat-input-expanded' : '',
            hasActivityIndicator ? 'rounded-t-none' : '',
          ].filter(Boolean).join(' ')}
          {...getRootProps()}
        >
          {isDragActive && <ComposerDropOverlay />}

          <ComposerAttachmentTray files={attachedFiles} onRemove={onRemoveAttachment} refused={refused} />

          <input {...getInputProps()} />

          {/* ONE ROW: the field, what goes with a message (a file, the voice), and the one button that sends or stops. Everything
              that sets the chat up rather than writes to it stands behind the chat's core (`settings`, below). */}
          <div className="flex items-end gap-1 py-1 pl-1 pr-2">
            <PromptInputBody className="min-w-0 flex-1">
              <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
                <div className="chat-input-placeholder block w-full whitespace-pre-wrap break-words px-4 py-2 text-sm leading-6 text-transparent">
                  {renderInputWithMentions(input)}
                </div>
              </div>
  
              <PromptInputTextarea
                ref={textareaRef}
                dir="auto"
                rows={1}
                value={input}
                onChange={onInputChange}
                onClick={onTextareaClick}
                onKeyDown={onTextareaKeyDown}
                onPaste={onTextareaPaste}
                onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
                onFocus={() => onInputFocusChange?.(true)}
                onBlur={() => onInputFocusChange?.(false)}
                onInput={onTextareaInput}
                placeholder={placeholder}
                // A placeholder longer than the line is cut with an ellipsis, never wrapped under itself: the line is one line until it is typed in.
                className="[&::placeholder]:overflow-hidden [&::placeholder]:text-ellipsis [&::placeholder]:whitespace-nowrap"
              />
          </PromptInputBody>

            <PromptInputTools className="mb-1 min-w-0 gap-0.5">
              {/* The plus (attach). The kit's 32px button keeps its size to the eye and takes a 44px catch under a finger. */}
              <PromptInputButton
                tooltip={{ content: t('input.attachFiles') }}
                onClick={openAttachmentPicker}
                aria-label={t('input.attachFiles')}
                className="relative before:absolute before:inset-0 before:content-[''] finger:before:-inset-1.5"
              >
                <PlusIcon />
              </PromptInputButton>

              {voiceShown && (
                <VoiceInputButton state={voiceState} onToggle={voiceToggle} />
              )}

              {/* `contents` at `sm` hands the tooltip's own div back to the flex row; below it the button is not offered, and a
                  hidden button inside a live div would still take a gap of the row. */}
              {hasInput && (
                <span className="hidden sm:contents">
                  <PromptInputButton
                    tooltip={{ content: t('input.clearInput', { defaultValue: 'Clear input' }) }}
                    onClick={onClearInput}
                  >
                    <XIcon />
                  </PromptInputButton>
                </span>
              )}
            </PromptInputTools>

            <PromptInputSubmit
              ref={sendButtonRef}
              // Press and hold is send-later. The click a hold always leaves behind is swallowed
              // here rather than in each branch below, so no path can send the message that the
              // menu is at that moment offering to schedule.
              onPointerDown={startLongPress}
              onPointerUp={cancelLongPress}
              onPointerLeave={cancelLongPress}
              onPointerCancel={cancelLongPress}
              onContextMenu={(e: MouseEvent<HTMLButtonElement>) => {
                // Holding a button raises the platform's own callout on some phones, which
                // would cover the menu the same gesture just opened.
                if (canHoldSend) e.preventDefault();
              }}
              onClickCapture={(e: MouseEvent<HTMLButtonElement>) => {
                if (!longPressFiredRef.current) return;
                longPressFiredRef.current = false;
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={
                canQueueDraft
                  ? (e: MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      onSubmit(e);
                    }
                  : isLoading
                    ? onAbortSession
                    : isRecording
                      ? (e: MouseEvent<HTMLButtonElement>) => {
                          e.preventDefault();
                          voiceStop({ send: true });
                        }
                      : undefined
              }
              disabled={
                isLoading
                  ? false
                  : isRecording
                    ? false
                    : isTranscribing
                      ? true
                      : !input.trim() && attachedFiles.length === 0
              }
              // The hold is the only way to reach send-later now that the clock button is gone, so
              // the button that answers it says so — in the tooltip and to a screen reader both.
              aria-label={sendLabelWithHint}
              title={sendLabelWithHint}
              // The kit's 32px send keeps its size to the eye and takes a 44px catch under a finger.
              className="relative mb-1 before:absolute before:inset-0 before:content-[''] finger:before:-inset-1.5"
            >
              {isTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : canQueueDraft ? (
                <ArrowUpIcon className="h-4 w-4" />
              ) : undefined}
            </PromptInputSubmit>

            {/* Draws no trigger — the send button above is it. */}
            <ScheduleMessagePopover
              isOpen={isScheduleOpen}
              onClose={closeSchedule}
              getTrigger={getSendButton}
              onSchedule={onScheduleMessage}
            />
            {/* The same button's hold while a turn runs. Its flag is cleared the moment a message can no longer be
                steered (above), so a turn that ends under the open menu takes it away for good. */}
            <SendMenuPopover
              isOpen={isSendMenuOpen}
              onClose={closeSendMenu}
              getTrigger={getSendButton}
              onSelect={(choice) => onSendMenuChoice?.(choice)}
            />
          </div>
      </PromptInput>
      </div>
      </div>
      </div>
    </div>
  );
}
