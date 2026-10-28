import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SetStateAction,
  TouchEvent,
} from 'react';
import { useDropzone } from 'react-dropzone';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { PROVIDER_PERMISSION_PREFERENCE_KEYS } from '@/shared/constants';
import { readUserPreference } from '@/shared/userSettings';
import { useSimpleChatListPreferences } from '@/shared/hooks/useSimpleChatListPreferences';
import { useHostMove, useHostWindow } from '@/shared/context/HostWindowContext';
import { applyPlainMode, usePlainModePreference } from '@/shared/hooks/usePlainModePreference';
import type { CommandModalPayload, CostCommandData, HelpCommandData, MarkSessionProcessing, ModelCommandData, QueuedDraft, SessionActivityMap, StatusCommandData,QueuedSendOptions,ChatAttachment,ChatMessage,PendingPermissionRequest,PermissionMode,SessionEstablishedContext,Project,ProjectSession,LLMProvider,SlashCommand,SentUserTurn } from '@/shared/types';
import { grantClaudeToolPermission } from '@/modules/chat/utils/chatPermissions';
import {
  appendQueuedMessage,
  clearQueuedMessage,
  createQueuedMessageId,
  hydrateChatDrafts,
  QueueRefusedError,
  readDraftText,
  readQueuedMessage,
  subscribeToChatDrafts,
  writeDraftText,
} from '@/shared/chatDrafts';
import { escapeRegExp } from '@/modules/chat/utils/chatFormatting';
import { useFileMentions } from '@/modules/chat/hooks/useFileMentions';
import { useInputHistory } from '@/modules/chat/hooks/useInputHistory';
import { useSlashCommands } from '@/modules/chat/hooks/useSlashCommands';
import { useRestartOnInstalledCli } from '@/modules/chat/hooks/useRestartOnInstalledCli';
import { useScopedAttachments } from '@/modules/chat/hooks/useScopedAttachments';
import { isEngineHandledCommand } from '@/shared/utils';

type UseChatComposerStateArgs = {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: LLMProvider;
  permissionMode: PermissionMode | string;
  cyclePermissionMode: () => void;
  resolvePermissionModeForProvider: (provider: LLMProvider, requestedMode: PermissionMode | string) => PermissionMode;
  /**
   * Model every send and command carries: the open session's model when there
   * is one, otherwise the user's per-provider selection.
   */
  currentProviderModel: string;
  currentProviderEffort: string;
  isLoading: boolean;
  processingSessions?: SessionActivityMap;
  canAbortSession: boolean;
  tokenBudget: Record<string, unknown> | null;
  sendMessage: (message: unknown) => void;
  sendByCtrlEnter?: boolean;
  onSessionProcessing?: MarkSessionProcessing;
  /**
   * Invoked with the freshly allocated session id when the user sends the
   * first message of a brand-new conversation. The backend allocates the id
   * via POST /api/providers/sessions BEFORE the websocket send, so the id is
   * stable for the conversation's whole lifetime — the consumer navigates to
   * /session/:id and records it as the current session.
   */
  onSessionEstablished?: (sessionId: string, context: SessionEstablishedContext) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  scrollToBottom: () => void;
  addMessage: (msg: ChatMessage) => void;
  /** Marks a message just sent as the one the operator is brought back to if they leave before the reply lands. */
  armReplyAnchor: (sessionId: string, sent: SentUserTurn) => void;
  setIsUserScrolledUp: (isScrolledUp: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
};

type MentionableFile = {
  name: string;
  path: string;
};

type CommandExecutionResult = {
  type: 'builtin' | 'custom';
  action?: string;
  data?: any;
  content?: string;
  hasBashCommands?: boolean;
  hasFileIncludes?: boolean;
};






const createFakeSubmitEvent = () => {
  return { preventDefault: () => undefined } as unknown as FormEvent<HTMLFormElement>;
};

const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

const isImageAttachment = (attachment: ChatAttachment) => {
  if (attachment.mimeType?.startsWith('image/')) return true;
  return /\.(gif|jpe?g|png|svg|webp)$/i.test(attachment.path || attachment.name || '');
};

const uploadAttachmentFiles = async (files: File[]): Promise<unknown[]> => {
  if (files.length === 0) {
    return [];
  }

  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });

  const response = await api.assets.uploadFiles(formData);

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || 'Failed to upload files');
  }

  const result = await response.json();
  if (!Array.isArray(result.attachments) || result.attachments.length !== files.length) {
    throw new Error('File upload returned an incomplete result');
  }
  return result.attachments;
};


const restoreQueuedDraft = (sessionKey: string): QueuedDraft | null => {
  const saved = readQueuedMessage(sessionKey);
  return saved
    ? {
        id: saved.id,
        content: saved.content,
        attachments: [],
        uploadedAttachments: saved.attachments ?? saved.images,
        options: saved.options,
      }
    : null;
};

// Whether the card already shows this stored queued message. Send options are not compared: the
// card does not show them.
const showsQueuedMessage = (card: QueuedDraft, stored: QueuedDraft): boolean => (
  card.content === stored.content
  && JSON.stringify(card.uploadedAttachments ?? []) === JSON.stringify(stored.uploadedAttachments ?? [])
);

// Whether a stored queued message is the card's message with more added after it (by this tab or
// another one), rather than a different message: only then do the card's browser files still
// belong to it. A card holds browser files only for attachments it uploaded, and every upload gets
// its own descriptor, so the stored message must start with the card's descriptors.
const extendsQueuedMessage = (card: QueuedDraft, stored: QueuedDraft): boolean => {
  const cardUploads = card.uploadedAttachments ?? [];
  const storedUploads = stored.uploadedAttachments ?? [];
  return JSON.stringify(storedUploads.slice(0, cardUploads.length)) === JSON.stringify(cardUploads);
};

const getNotificationSessionSummary = (
  selectedSession: ProjectSession | null,
  fallbackInput: string,
): string | null => {
  const sessionSummary = selectedSession?.summary || selectedSession?.name || selectedSession?.title;
  if (typeof sessionSummary === 'string' && sessionSummary.trim()) {
    const normalized = sessionSummary.replace(/\s+/g, ' ').trim();
    return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
  }

  const normalizedFallback = fallbackInput.replace(/\s+/g, ' ').trim();
  if (!normalizedFallback) {
    return null;
  }

  return normalizedFallback.length > 80 ? `${normalizedFallback.slice(0, 77)}...` : normalizedFallback;
};

export function useChatComposerState({
  selectedProject,
  selectedSession,
  currentSessionId,
  provider,
  permissionMode,
  cyclePermissionMode,
  resolvePermissionModeForProvider,
  currentProviderModel,
  currentProviderEffort,
  isLoading,
  processingSessions,
  canAbortSession,
  tokenBudget,
  sendMessage,
  sendByCtrlEnter,
  onSessionProcessing,
  onSessionEstablished,
  onFileOpen,
  onShowSettings,
  scrollToBottom,
  addMessage,
  armReplyAnchor,
  setIsUserScrolledUp,
  setPendingPermissionRequests,
}: UseChatComposerStateArgs) {
  const { t } = useTranslation('chat');
  // Whether a brand-new session minted from this composer should be tagged
  // into the simple chat list — decided by the preference at mint time, not
  // threaded down as a prop.
  const { enabled: simpleChatListEnabled } = useSimpleChatListPreferences();
  const { enabled: plainModeEnabled } = usePlainModePreference();

  // The composer text together with the chat scope it belongs to. They are one
  // state rather than a value plus a ref because they have to move in lockstep:
  // on a session switch there is one commit where the scope has already changed
  // while the text has not, and anything that persisted the text in that commit
  // would write the previous session's message into the new session's draft.
  // A ref cannot express this — React evaluates a state updater eagerly, so a
  // ref set inside one is already ahead by the time the effects run.
  //
  // Restored synchronously from the draft mirror so a reload shows what was
  // being typed on the first paint rather than after the drafts request lands.
  /**
   * The already-sent message the composer is currently replacing, or null.
   *
   * Holds the anchor rather than the message, because that is all the send
   * needs and it keeps a stale message object from being captured while the
   * transcript refreshes underneath the composer.
   */
  const [editingAnchorId, setEditingAnchorId] = useState<string | null>(null);

  const [inputState, setInputState] = useState<{ scope: string | null; value: string }>(() => {
    if (typeof window === 'undefined') {
      return { scope: null, value: '' };
    }
    const initialScope = selectedSession?.id || currentSessionId
      || (selectedProject ? `project:${selectedProject.projectId}` : null);
    return {
      scope: initialScope,
      value: initialScope ? readDraftText(initialScope) : '',
    };
  });
  const input = inputState.value;
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [commandModalPayload, setCommandModalPayload] = useState<CommandModalPayload | null>(null);

  // The window the chat is drawn in. The deferred submits and the scroll after a send are timers the
  // reader waits on, so they run there (a hidden opener throttles its timers to one a second); the
  // confirm asks in the window the reader is looking at. The 5 s draft poll below stays on the
  // opener's clock: it reconciles data and nothing the reader is waiting on.
  const hostWindow = useHostWindow();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // A chat that floats takes the reader's typing with it: the press that floated it had its focus
  // in the tab, and the window it lands in has none yet.
  useHostMove(({ phase, floating }) => {
    if (phase === 'after' && floating) textareaRef.current?.focus();
  });
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const textareaLineHeightRef = useRef<number | null>(null);
  const lastAutosizedInputRef = useRef<string | null>(null);
  const handleSubmitRef = useRef<
    ((
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
      queuedSubmission?: QueuedDraft,
    ) => Promise<void>) | null
  >(null);
  const inputValueRef = useRef(input);
  const selectedProjectId = selectedProject?.projectId;
  // Prefer the stable backend-allocated id (selectedSession.id) but fall back
  // to currentSessionId for a just-established session that hasn't been
  // handed back to the parent's `selectedSession` prop yet.
  const sessionKey = selectedSession?.id || currentSessionId || null;
  // The chat scope a draft belongs to: the open session, or the project for a
  // chat that has not been sent yet and so has no session id. Drafts used to be
  // keyed by project alone, so every session in a project shared one draft.
  const draftScope = sessionKey ?? (selectedProjectId ? `project:${selectedProjectId}` : null);
  const draftScopeRef = useRef(draftScope);
  draftScopeRef.current = draftScope;
  // Attachments belong to the same scope as the text, so a photo stays with the chat it was added to.
  const { attachedFiles, setAttachedFiles, clearAttachmentsFor, fileErrors, setFileErrors } =
    useScopedAttachments(draftScope);
  const setInput = useCallback<Dispatch<SetStateAction<string>>>((next) => {
    setInputState((previous) => ({
      scope: draftScopeRef.current,
      value: typeof next === 'function' ? next(previous.value) : next,
    }));
  }, []);
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;

  // Recall writes go through the same pair of stores a send reads: the state
  // (for the render) and inputValueRef (so an immediate Enter submits the
  // recalled text, not a stale value).
  const setInputFromHistory = useCallback((value: string) => {
    setInput(value);
    inputValueRef.current = value;
  }, [setInput]);
  const { recordSentMessage, handleHistoryKeyDown } = useInputHistory({
    setInput: setInputFromHistory,
    textareaRef,
    scope: draftScope,
  });

  const [queuedDraft, setQueuedDraft] = useState<QueuedDraft | null>(() => {
    if (typeof window === 'undefined' || !sessionKey) {
      return null;
    }
    return restoreQueuedDraft(sessionKey);
  });
  // Which session the in-memory `queuedDraft` belongs to, so editing or deleting the card clears
  // that session's queued message. On a session switch there is one commit where `sessionKey`
  // already points at the new session while `queuedDraft` still holds the old session's draft.
  const queuedDraftSessionRef = useRef<string | null>(sessionKey);
  // True from the press that queues a typed message until the composer has been emptied of it (the
  // upload between the two can take seconds). Another press in that window would queue the same
  // text again, and a queued message is now added to, not replaced.
  const queueTakeInFlightRef = useRef(false);

  const handleBuiltInCommand = useCallback(
    (result: CommandExecutionResult) => {
      const { action, data } = result;
      switch (action) {
        case 'help':
          setCommandModalPayload({
            kind: 'help',
            data: (data || {}) as HelpCommandData,
          });
          break;

        case 'models':
          setCommandModalPayload({
            kind: 'models',
            data: (data || {}) as ModelCommandData,
          });
          break;

        case 'cost': {
          setCommandModalPayload({
            kind: 'cost',
            data: (data || {}) as CostCommandData,
          });
          break;
        }

        case 'status': {
          setCommandModalPayload({
            kind: 'status',
            data: (data || {}) as StatusCommandData,
          });
          break;
        }

        case 'memory':
          if (data.error) {
            addMessage({
              type: 'assistant',
              content: `Warning: ${data.message}`,
              timestamp: Date.now(),
            });
          } else {
            addMessage({
              type: 'assistant',
              content: `${data.message}\n\nPath: \`${data.path}\``,
              timestamp: Date.now(),
            });
            if (data.exists && onFileOpen) {
              onFileOpen(data.path);
            }
          }
          break;

        case 'config':
          onShowSettings?.();
          break;

        default:
          console.warn('Unknown built-in command action:', action);
      }
    },
    [onFileOpen, onShowSettings, addMessage],
  );

  const closeCommandModal = useCallback(() => {
    setCommandModalPayload(null);
  }, []);

  const handleCustomCommand = useCallback(async (result: CommandExecutionResult) => {
    const { content, hasBashCommands } = result;

    if (hasBashCommands) {
      const confirmed = hostWindow.confirm(
        'This command contains bash commands that will be executed. Do you want to proceed?',
      );
      if (!confirmed) {
        addMessage({
          type: 'assistant',
          content: 'Command execution cancelled',
          timestamp: Date.now(),
        });
        return;
      }
    }

    const commandContent = content || '';
    setInput(commandContent);
    inputValueRef.current = commandContent;

    // Defer submit to next tick so the command text is reflected in UI before dispatching.
    hostWindow.setTimeout(() => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent());
      }
    }, 0);
  }, [addMessage, hostWindow]);

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string, options?: { preserveInput?: boolean }) => {
      if (!command || !selectedProject) {
        return;
      }

      try {
        const effectiveInput = rawInput ?? input;
        const commandMatch = effectiveInput.match(new RegExp(`${escapeRegExp(command.name)}\\s*(.*)`));
        const args =
          commandMatch && commandMatch[1] ? commandMatch[1].trim().split(/\s+/) : [];

        // The `/api/commands/execute` context sends `projectId` now instead of
        // a folder-derived project name; the path is still included verbatim.
        const context = {
          projectPath: selectedProject.fullPath || selectedProject.path,
          projectId: selectedProject.projectId,
          sessionId: currentSessionId || selectedSession?.id || null,
          provider,
          model: currentProviderModel,
          tokenUsage: tokenBudget,
        };

        const response = await api.commands.execute({
          commandName: command.name,
          commandPath: command.path,
          args,
          context,
        });

        if (!response.ok) {
          let errorMessage = `Failed to execute command (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData?.message || errorData?.error || errorMessage;
          } catch {
            // Ignore JSON parse failures and use fallback message.
          }
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as CommandExecutionResult;
        if (result.type === 'builtin') {
          handleBuiltInCommand(result);
          if (!options?.preserveInput) {
            setInput('');
            inputValueRef.current = '';
          }
        } else if (result.type === 'custom') {
          await handleCustomCommand(result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error executing command:', error);
        addMessage({
          type: 'assistant',
          content: `Error executing command: ${message}`,
          timestamp: Date.now(),
        });
      }
    },
    [
      currentProviderModel,
      currentSessionId,
      handleBuiltInCommand,
      handleCustomCommand,
      input,
      provider,
      selectedProject,
      selectedSession?.id,
      addMessage,
      tokenBudget,
    ],
  );

  /**
   * Compaction, from the token-usage panel.
   *
   * `/compact` is the CLI's own command, not one of this app's built-ins: it is sent as the
   * next message, exactly as typing it would, and the CLI replies with a compact boundary. The
   * deferred submit is the same idiom `handleCustomCommand` uses — the text has to be in the
   * composer's state before the submit reads it.
   */
  const compactConversation = useCallback(() => {
    setInput('/compact');
    inputValueRef.current = '/compact';
    hostWindow.setTimeout(() => {
      handleSubmitRef.current?.(createFakeSubmitEvent());
    }, 0);
  }, [hostWindow, setInput]);

  const showCostModal = useCallback(() => {
    executeCommand(
      {
        name: '/cost',
        description: 'Display token usage information',
        namespace: 'builtin',
        metadata: { type: 'builtin' },
      } as SlashCommand,
      '/cost',
      { preserveInput: true },
    );
  }, [executeCommand]);

  const {
    slashCommands,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  } = useSlashCommands({
    selectedProject,
    provider,
    input,
    setInput,
    textareaRef,
    onExecuteCommand: executeCommand,
  });

  const {
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    setCursorPosition,
    handleFileMentionsKeyDown,
  } = useFileMentions({
    selectedProject,
    input,
    setInput,
    textareaRef,
  });

  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    if (!inputHighlightRef.current || !target) {
      return;
    }
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const resizeTextarea = useCallback((target: HTMLTextAreaElement) => {
    target.style.height = 'auto';
    const nextHeight = Math.max(22, target.scrollHeight);
    target.style.height = `${nextHeight}px`;

    let lineHeight = textareaLineHeightRef.current;
    if (!lineHeight) {
      // The textarea's own window: a computed style is read from the window whose document
      // holds the element, and the textarea may stand in a floating window.
      const ownWindow = target.ownerDocument.defaultView ?? window;
      lineHeight = parseInt(ownWindow.getComputedStyle(target).lineHeight);
      textareaLineHeightRef.current = Number.isFinite(lineHeight) ? lineHeight : 24;
    }

    const expanded = nextHeight > (textareaLineHeightRef.current || 24) * 2;
    setIsTextareaExpanded((previous) => previous === expanded ? previous : expanded);
    lastAutosizedInputRef.current = target.value;
  }, []);

  const handleAttachmentFiles = useCallback((files: File[]) => {
    const validFiles = files.filter((file) => {
      try {
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return false;
        }

        if (file.size > MAX_ATTACHMENT_SIZE) {
          const fileName = file.name || 'Unknown file';
          setFileErrors((previous) => {
            const next = new Map(previous);
            next.set(fileName, 'File too large (max 10MB)');
            return next;
          });
          return false;
        }

        return true;
      } catch (error) {
        console.error('Error validating file:', error, file);
        return false;
      }
    });

    if (validFiles.length > 0) {
      setAttachedFiles((previous) => [...previous, ...validFiles].slice(0, MAX_ATTACHMENT_COUNT));
    }
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);

      items.forEach((item) => {
        if (!item.type.startsWith('image/')) {
          return;
        }
        const file = item.getAsFile();
        if (file) {
          handleAttachmentFiles([file]);
        }
      });

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        const files = Array.from(event.clipboardData.files);
        const imageFiles = files.filter((file) => file.type.startsWith('image/'));
        if (imageFiles.length > 0) {
          handleAttachmentFiles(imageFiles);
        }
      }
    },
    [handleAttachmentFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    maxSize: MAX_ATTACHMENT_SIZE,
    maxFiles: MAX_ATTACHMENT_COUNT,
    onDrop: handleAttachmentFiles,
    noClick: true,
    noKeyboard: true,
  });

  // Snapshot of everything `chat.send` needs beyond the text itself. Built at
  // send time for immediate sends and at queue time for queued ones, so a
  // queued message keeps the provider settings it was composed under even if
  // it is later dispatched outside this composer (app-level auto-send).
  const buildSendOptions = useCallback((currentInput: string): QueuedSendOptions => {
    const getToolsSettings = () => readUserPreference(
      PROVIDER_PERMISSION_PREFERENCE_KEYS[provider],
      {
        allowedTools: [],
        disallowedTools: [],
        skipPermissions: false,
      },
    );

    const toolsSettings = getToolsSettings();

    return {
      model: currentProviderModel,
      effort: currentProviderEffort,
      permissionMode: resolvePermissionModeForProvider(provider, permissionMode),
      toolsSettings,
      skipPermissions: toolsSettings?.skipPermissions || false,
      sessionSummary: getNotificationSessionSummary(selectedSession, currentInput),
    };
  }, [
    currentProviderEffort,
    currentProviderModel,
    permissionMode,
    provider,
    resolvePermissionModeForProvider,
    selectedSession,
  ]);

  // Hands a message to the server's queue to be sent "when this finishes" and shows it as the
  // queued card. Attachments must already be uploaded.
  //
  // A session has one queued turn. A message queued while another is still waiting is added after
  // it rather than replacing it, so a burst of follow-ups all reach the provider, in order, as that
  // turn. The server does the append against what it has stored, and the card shows what it
  // returns: exactly what will be sent.
  //
  // A message typed in the composer (`takenFromComposer`) empties it when it is taken, as a direct
  // send does, not when the server answers: what the user types during that round trip is the next
  // follow-up and must not be erased with this one. If the server refuses the message it goes back
  // into the composer, in front of anything typed since, and the composer says so, rather than
  // showing a card nothing will send. A message the app queues itself touches no composer.
  const queueMessage = useCallback(
    async (
      durableDraft: QueuedDraft,
      queuedSessionKey: string | null,
      submitScope: string | null,
      takenFromComposer: boolean,
    ) => {
      const queuedFromOpenComposer = takenFromComposer
        && (!queuedSessionKey || sessionKeyRef.current === queuedSessionKey);
      if (queuedFromOpenComposer) {
        setInput('');
        inputValueRef.current = '';
        clearAttachmentsFor(submitScope);
        resetCommandMenuState();
        setIsTextareaExpanded(false);
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
        if (draftScopeRef.current) {
          writeDraftText(draftScopeRef.current, '');
        }
      } else if (takenFromComposer) {
        // The user changed sessions during the upload. The composer they left still holds the text
        // and files as its draft: clear them, or going back and pressing Enter would queue the same
        // message a second time.
        clearAttachmentsFor(submitScope);
        if (submitScope && readDraftText(submitScope) === durableDraft.content) {
          writeDraftText(submitScope, '');
        }
      }

      let queuedCard = durableDraft;
      let appendedToEarlierMessage = false;
      if (queuedSessionKey) {
        try {
          const { queuedMessage, appended } = await appendQueuedMessage(queuedSessionKey, {
            id: durableDraft.id,
            content: durableDraft.content,
            options: durableDraft.options,
            attachments: durableDraft.uploadedAttachments ?? [],
          });
          appendedToEarlierMessage = appended;
          queuedCard = {
            id: queuedMessage.id,
            content: queuedMessage.content,
            attachments: durableDraft.attachments,
            uploadedAttachments: queuedMessage.attachments,
            options: queuedMessage.options,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('Failed to queue message:', error);
          addMessage({
            type: 'error',
            // A slash command is refused by design, and the reason is said in the user's language;
            // any other failure shows the server's text.
            content: error instanceof QueueRefusedError && error.code === 'QUEUED_MESSAGE_NOT_COMBINABLE'
              ? t('input.queue.notCombinable')
              : `Failed to queue message: ${message}`,
            timestamp: new Date(),
          });
          if (!takenFromComposer) {
            return;
          }
          const withTypedSince = (typedSince: string) => (
            [durableDraft.content, typedSince].filter((part) => part.trim()).join('\n\n')
          );
          if (sessionKeyRef.current === queuedSessionKey) {
            const restored = withTypedSince(inputValueRef.current);
            setInput(restored);
            inputValueRef.current = restored;
            if (queuedFromOpenComposer) {
              setAttachedFiles((current) => [...durableDraft.attachments, ...current]);
            }
            if (draftScopeRef.current) {
              writeDraftText(draftScopeRef.current, restored);
            }
          } else if (submitScope) {
            // Browser files cannot follow it into a composer that is not open.
            writeDraftText(submitScope, withTypedSince(readDraftText(submitScope)));
          }
          return;
        }
      }

      // Recorded under the session the message was queued FOR, and before the session-switch
      // return below — the queued text must be recallable even when it dispatches without this
      // composer.
      if (takenFromComposer) {
        recordSentMessage(durableDraft.content, queuedSessionKey);
      }

      // The server owns dispatch after persistence. If the user changed sessions meanwhile, the
      // durable record is already enough; do not attach its UI card to the newly opened composer.
      if (queuedSessionKey && sessionKeyRef.current !== queuedSessionKey) {
        return;
      }

      queuedDraftSessionRef.current = queuedSessionKey;
      // The browser files of the messages queued before this one stay with the card, so editing it
      // brings all of them back into the composer; not when the earlier one was already sent and
      // this one queued alone.
      setQueuedDraft((previous) => ({
        ...queuedCard,
        attachments: appendedToEarlierMessage && previous && extendsQueuedMessage(previous, queuedCard)
          ? [...previous.attachments, ...queuedCard.attachments]
          : queuedCard.attachments,
      }));
    },
    [addMessage, clearAttachmentsFor, recordSentMessage, resetCommandMenuState, setAttachedFiles, setInput, t],
  );

  const handleSubmit = useCallback(
    async (
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
      queuedSubmission?: QueuedDraft,
    ) => {
      event.preventDefault();
      // The chat this send was pressed in; an upload awaited below can outlast a switch to another.
      const submitScope = draftScopeRef.current;
      const currentInput = queuedSubmission?.content ?? inputValueRef.current;
      const currentAttachments = queuedSubmission?.attachments ?? attachedFiles;
      const previouslyUploadedAttachments = queuedSubmission?.uploadedAttachments ?? [];
      if (
        (
          !currentInput.trim()
          && currentAttachments.length === 0
          && previouslyUploadedAttachments.length === 0
        )
        || !selectedProject
      ) {
        return;
      }

      // A turn is already in flight: stash this message instead of sending it.
      // Upload attached files now so the queued record contains durable image
      // descriptors that can be sent even if another session is open later.
      if (isLoading) {
        // A run can restart in the tiny gap between scheduling and flushing a message the app
        // itself submits (the restart's resume). Queue it as it is, without uploading its files
        // again and without touching what the user has typed.
        if (queuedSubmission) {
          await queueMessage(
            {
              id: queuedSubmission.id ?? createQueuedMessageId(),
              content: queuedSubmission.content,
              attachments: queuedSubmission.attachments,
              uploadedAttachments: queuedSubmission.uploadedAttachments ?? [],
              options: queuedSubmission.options ?? buildSendOptions(currentInput),
            },
            sessionKey,
            submitScope,
            false,
          );
          return;
        }

        if (queueTakeInFlightRef.current) {
          return;
        }
        queueTakeInFlightRef.current = true;
        // Released the moment the composer is emptied; the `finally` releases it only if that never
        // happened, so it cannot clear a later press's hold.
        let holdsQueueTake = true;
        try {
          const queuedOptions = buildSendOptions(currentInput);
          const queuedSessionKey = sessionKey;
          let uploadedAttachments: unknown[] = [];
          try {
            uploadedAttachments = await uploadAttachmentFiles(currentAttachments);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('Queued file upload failed:', error);
            addMessage({
              type: 'error',
              content: `Failed to upload files: ${message}`,
              timestamp: new Date(),
            });
            return;
          }

          // `queueMessage` empties the composer before its first await, so the message is taken by
          // the time it returns its promise: the next press is a new message, not this one again.
          const queueing = queueMessage(
            {
              id: createQueuedMessageId(),
              content: currentInput,
              attachments: currentAttachments,
              uploadedAttachments,
              options: queuedOptions,
            },
            queuedSessionKey,
            submitScope,
            true,
          );
          queueTakeInFlightRef.current = false;
          holdsQueueTake = false;
          await queueing;
        } finally {
          if (holdsQueueTake) {
            queueTakeInFlightRef.current = false;
          }
        }
        return;
      }

      // Intercept slash commands only when "/" is the first input character.
      // Also accept exact "help" as a convenience alias for users who expect CLI-style help.
      const commandInput = currentInput.trimEnd();
      const isHelpAlias = commandInput.trim().toLowerCase() === 'help';
      if (commandInput.startsWith('/') || isHelpAlias) {
        const firstSpace = commandInput.indexOf(' ');
        const commandName = isHelpAlias
          ? '/help'
          : firstSpace > 0 ? commandInput.slice(0, firstSpace) : commandInput;
        const matchedCommand =
          slashCommands.find((cmd: SlashCommand) => cmd.name === commandName) ||
          (commandName === '/help'
            ? ({
                name: '/help',
                description: 'Show help documentation for Claude Code',
                namespace: 'builtin',
                metadata: { type: 'builtin' },
              } as SlashCommand)
            : undefined);
        // A skill or an engine command (/compact, /usage...) is the engine's own: it goes to the wire as typed.
        if (matchedCommand && !isEngineHandledCommand(matchedCommand)) {
          executeCommand(matchedCommand, isHelpAlias ? '/help' : commandInput);
          recordSentMessage(currentInput);
          setInput('');
          inputValueRef.current = '';
          clearAttachmentsFor(submitScope);
          resetCommandMenuState();
          setIsTextareaExpanded(false);
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
          }
          return;
        }
      }

      // What the CLI receives. The echo above the composer keeps `currentInput`
      // as typed; only the wire copy wears the `/plain` prefix.
      const messageContent = applyPlainMode(currentInput, plainModeEnabled);

      let uploadedAttachments = previouslyUploadedAttachments;
      if (uploadedAttachments.length === 0 && currentAttachments.length > 0) {
        try {
          uploadedAttachments = await uploadAttachmentFiles(currentAttachments);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('File upload failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to upload files: ${message}`,
            timestamp: new Date(),
          });
          return;
        }
      }

      const resolvedProjectPath = selectedProject.fullPath || selectedProject.path || '';
      const sessionSummary = getNotificationSessionSummary(selectedSession, currentInput);

      // The conversation always has a stable backend-allocated session id
      // BEFORE the first websocket send: brand-new chats allocate one here
      // via the session gateway. There is no client-visible session-id
      // handoff later — this id stays valid for the conversation's lifetime.
      let targetSessionId = selectedSession?.id || currentSessionId || null;
      if (!targetSessionId) {
        let createdSessionName = sessionSummary;
        try {
          const response = await api.providers.createSession({
            provider,
            projectPath: resolvedProjectPath,
            initialMessage: currentInput,
            simpleList: simpleChatListEnabled,
          });
          if (!response.ok) {
            throw new Error(`Failed to create session (${response.status})`);
          }
          const body = await response.json();
          targetSessionId = body?.data?.sessionId || null;
          // A blank server name would leave the session unlabeled, so the local
          // summary stays the fallback unless a real name comes back.
          const returnedSessionName = typeof body?.data?.sessionName === 'string'
            ? body.data.sessionName.trim()
            : '';
          if (returnedSessionName) {
            createdSessionName = returnedSessionName;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('Session creation failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to start a new session: ${message}`,
            timestamp: new Date(),
          });
          return;
        }

        if (!targetSessionId) {
          addMessage({
            type: 'error',
            content: 'Failed to start a new session: no session id returned.',
            timestamp: new Date(),
          });
          return;
        }

        onSessionEstablished?.(targetSessionId, {
          provider,
          project: selectedProject,
          summary: createdSessionName,
        });
      }

      const attachmentRecords = uploadedAttachments as ChatAttachment[];
      const userMessage: ChatMessage = {
        type: 'user',
        content: currentInput,
        images: attachmentRecords.filter(isImageAttachment),
        files: attachmentRecords.filter((attachment) => !isImageAttachment(attachment)),
        timestamp: new Date(),
        // Tags this echo as the replacement, so the truncation the server
        // broadcasts a moment later cuts the turns being replaced without
        // taking the message the user just sent with them.
        ...(editingAnchorId ? { replacesAnchorId: editingAnchorId } : {}),
      };

      addMessage(userMessage);
      // Where the operator replied: the message they are brought back to if they leave before the reply
      // lands. Identified by what it said and when — its echo's id and stamp change when the persisted
      // row replaces it.
      armReplyAnchor(targetSessionId, {
        text: currentInput,
        imageCount: userMessage.images?.length ?? 0,
        fileCount: userMessage.files?.length ?? 0,
        sentAtMs: userMessage.timestamp instanceof Date ? userMessage.timestamp.getTime() : Date.now(),
      });
      // Mark this request as processing in the per-session activity map (the
      // single source of truth the indicator derives from). The id is always
      // concrete at this point — no pending placeholder exists anymore.
      onSessionProcessing?.(targetSessionId, {
        statusText: null,
        canInterrupt: true,
      });

      setIsUserScrolledUp(false);
      hostWindow.setTimeout(() => scrollToBottom(), 100);

      // One message shape for every provider. The backend resolves the
      // provider, project path, and provider-native resume id from the
      // session row; `options` only carries composer-level preferences.
      sendMessage({
        // Replacing an already-sent message is its own frame: it changes the
        // shape of the conversation, so it gets validated separately and can
        // report why it was refused.
        type: editingAnchorId ? 'chat.edit-send' : 'chat.send',
        sessionId: targetSessionId,
        ...(editingAnchorId ? { anchorId: editingAnchorId } : {}),
        content: messageContent,
        options: {
          ...(queuedSubmission?.options ?? buildSendOptions(messageContent)),
          attachments: uploadedAttachments,
        },
      });
      setEditingAnchorId(null);

      // Recorded under the (possibly just-allocated) session id, so the first
      // message of a new chat lands in the history of the session the user is
      // navigated to. Queued drafts were recorded when they were queued; the
      // consecutive-duplicate check keeps this second call a no-op.
      recordSentMessage(currentInput, targetSessionId);
      setInput('');
      inputValueRef.current = '';
      resetCommandMenuState();
      clearAttachmentsFor(submitScope);
      setIsTextareaExpanded(false);

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      if (draftScopeRef.current) {
        writeDraftText(draftScopeRef.current, '');
      }
    },
    [
      selectedSession,
      attachedFiles,
      buildSendOptions,
      clearAttachmentsFor,
      currentSessionId,
      editingAnchorId,
      executeCommand,
      isLoading,
      onSessionProcessing,
      onSessionEstablished,
      provider,
      queueMessage,
      recordSentMessage,
      resetCommandMenuState,
      scrollToBottom,
      hostWindow,
      selectedProject,
      sendMessage,
      sessionKey,
      addMessage,
      armReplyAnchor,
      setIsUserScrolledUp,
      simpleChatListEnabled,
      plainModeEnabled,
      slashCommands,
    ],
  );

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  // The VPS dispatcher owns sending. While the card is visible, periodically reconcile it with the
  // server, so the UI notices when the server claims it or another tab adds to it.
  useEffect(() => {
    if (!sessionKey || !queuedDraft) {
      return;
    }
    let cancelled = false;
    const reconcile = async () => {
      await hydrateChatDrafts();
      if (cancelled) {
        return;
      }
      // The card shows what will be sent, so it follows the server's copy.
      const stored = restoreQueuedDraft(sessionKey);
      if (!stored) {
        queuedDraftSessionRef.current = sessionKey;
        setQueuedDraft(null);
        return;
      }
      setQueuedDraft((card) => {
        if (!card || showsQueuedMessage(card, stored)) {
          return card;
        }
        // This tab's browser files stay with its part of the message, so editing the card still
        // brings them back into the composer.
        return extendsQueuedMessage(card, stored) ? { ...stored, attachments: card.attachments } : stored;
      });
    };
    const timer = setInterval(() => void reconcile(), 5_000);
    // A hidden tab's timers are throttled (to about once a minute after a few minutes), so its
    // card can be far behind; catch up as soon as it is shown.
    const reconcileWhenShown = () => {
      if (hostWindow.document.visibilityState === 'visible') {
        void reconcile();
      }
    };
    hostWindow.document.addEventListener('visibilitychange', reconcileWhenShown);
    return () => {
      cancelled = true;
      clearInterval(timer);
      hostWindow.document.removeEventListener('visibilitychange', reconcileWhenShown);
    };
  }, [hostWindow, queuedDraft, sessionKey]);

  // True while an Edit or Delete of the card waits on the server's answer; a second press meanwhile
  // would ask the server to clear what the first has not finished clearing.
  const queueClearInFlightRef = useRef(false);

  // Takes the card's message off the server's queue at once, before the dispatcher's next poll can
  // send it, and answers the message the server REALLY removed — which can hold more than the card
  // shows, because another tab may have added to it since the card was last refreshed. Answers null
  // when the server did not apply the clear: the message is still queued there and will be sent, so
  // the card stays, and the user is told, instead of the card going while the message stays.
  // `removed` is null when nothing was waiting any more (the dispatcher had already sent it).
  const takeCardOffServerQueue = useCallback(
    async (card: QueuedDraft): Promise<{ removed: QueuedDraft | null } | null> => {
      const scope = queuedDraftSessionRef.current;
      if (!scope) {
        // A card with no session behind it was never on the server's queue.
        return { removed: card };
      }
      if (queueClearInFlightRef.current) {
        return null;
      }
      queueClearInFlightRef.current = true;
      try {
        const cleared = await clearQueuedMessage(scope);
        if (!cleared.landed) {
          addMessage({
            type: 'error',
            content: `Failed to remove the queued message: ${cleared.sentence ?? 'The server did not answer'}. It is still queued.`,
            timestamp: new Date(),
          });
          return null;
        }
        if (!cleared.removed) {
          return { removed: null };
        }
        const attachments = cleared.removed.attachments ?? cleared.removed.images ?? [];
        const removed: QueuedDraft = {
          id: cleared.removed.id,
          content: cleared.removed.content,
          attachments: [],
          uploadedAttachments: attachments,
          options: cleared.removed.options,
        };
        // This tab's browser files go back with the message only when it is the card's message,
        // with more added after it (see `extendsQueuedMessage`).
        return { removed: { ...removed, attachments: extendsQueuedMessage(card, removed) ? card.attachments : [] } };
      } finally {
        queueClearInFlightRef.current = false;
      }
    },
    [addMessage],
  );

  // Edit hands the composer what the server removed, not what the card showed. A session switch
  // during the round trip leaves the card and the composer alone (they now belong to the other
  // session) and writes the text to the draft of the session it came from.
  const editQueuedDraft = useCallback(async () => {
    if (!queuedDraft) {
      return;
    }
    const scope = queuedDraftSessionRef.current;
    const taken = await takeCardOffServerQueue(queuedDraft);
    if (!taken) {
      return;
    }
    const stillOpen = !scope || sessionKeyRef.current === scope;
    if (stillOpen) {
      setQueuedDraft(null);
    }
    // Nothing removed: the message was sent between the card and the press, so there is nothing
    // to take back and putting the card's text in the composer would send it twice.
    if (!taken.removed) {
      return;
    }
    if (!stillOpen) {
      if (scope) {
        writeDraftText(scope, taken.removed.content);
      }
      return;
    }
    setInput(taken.removed.content);
    inputValueRef.current = taken.removed.content;
    setAttachedFiles(taken.removed.attachments);
    textareaRef.current?.focus();
  }, [queuedDraft, setAttachedFiles, setInput, takeCardOffServerQueue]);

  // Delete removes what the server held. When that is more than the card showed (a follow-up added
  // in another tab), the message line says so and carries the text, rather than losing it silently.
  const deleteQueuedDraft = useCallback(async () => {
    if (!queuedDraft) {
      return;
    }
    const scope = queuedDraftSessionRef.current;
    const taken = await takeCardOffServerQueue(queuedDraft);
    if (!taken) {
      return;
    }
    if (!scope || sessionKeyRef.current === scope) {
      setQueuedDraft(null);
    }
    if (taken.removed && !showsQueuedMessage(queuedDraft, taken.removed)) {
      addMessage({
        type: 'error',
        content: `The queued message held more than its card showed, and all of it was deleted:\n\n${taken.removed.content}`,
        timestamp: new Date(),
      });
    }
  }, [addMessage, queuedDraft, takeCardOffServerQueue]);

  // A voice transcript either fills the input (to edit before sending) or, when the
  // user tapped "stop and send", is submitted straight away. Mirror the value into
  // inputValueRef synchronously so handleSubmit reads the new text, not the stale state.
  const handleVoiceTranscript = useCallback((text: string, send?: boolean) => {
    const base = inputValueRef.current.trim();
    const next = base ? `${base} ${text}` : text;
    setInput(next);
    inputValueRef.current = next;
    if (send) handleSubmitRef.current?.(createFakeSubmitEvent());
  }, [setInput]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  // Swap in the open scope's draft, and pick up one that arrives from another
  // device with the hydrated drafts.
  useEffect(() => {
    if (!draftScope) {
      return;
    }

    const restoreDraft = () => {
      const savedInput = readDraftText(draftScope);
      setInputState((previous) => {
        if (previous.scope === draftScope && previous.value === savedInput) {
          return previous;
        }
        inputValueRef.current = savedInput;
        return { scope: draftScope, value: savedInput };
      });
    };

    restoreDraft();
    return subscribeToChatDrafts(restoreDraft);
  }, [draftScope]);

  // Only persist text that was typed for the scope it is about to be written
  // to; see the inputState declaration for why the scope travels with the text.
  useEffect(() => {
    if (!draftScope || inputState.scope !== draftScope) {
      return;
    }
    writeDraftText(draftScope, inputState.value);
  }, [inputState, draftScope]);

  // The card is never written back to storage: the server owns the queued message, and this page's
  // copy of it may already be out of date (sent, or added to from another tab). Queueing appends on
  // the server; editing and deleting clear it there.

  // Switching sessions swaps in that session's queued draft. Browser File
  // objects are local to the mounted composer, while their already-uploaded
  // descriptors restore from storage and remain sendable.
  useEffect(() => {
    queuedDraftSessionRef.current = sessionKey;
    if (!sessionKey) {
      setQueuedDraft(null);
      return;
    }
    setQueuedDraft(restoreQueuedDraft(sessionKey));
  }, [sessionKey]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    if (lastAutosizedInputRef.current === input) {
      return;
    }
    // Re-run for restored drafts and programmatic input changes. User typing is
    // already resized in onInput, so this avoids doing the same forced layout twice.
    resizeTextarea(textareaRef.current);
  }, [input, resizeTextarea]);

  useEffect(() => {
    if (!textareaRef.current || input.trim()) {
      return;
    }
    textareaRef.current.style.height = 'auto';
    setIsTextareaExpanded(false);
  }, [input]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      setInput(newValue);
      inputValueRef.current = newValue;
      setCursorPosition(cursorPos);

      if (!newValue.trim()) {
        event.target.style.height = 'auto';
        setIsTextareaExpanded(false);
        resetCommandMenuState();
        return;
      }

      handleCommandInputChange(newValue, cursorPos);
    },
    [handleCommandInputChange, resetCommandMenuState, setCursorPosition],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleCommandMenuKeyDown(event)) {
        return;
      }

      if (handleFileMentionsKeyDown(event)) {
        return;
      }

      if (handleHistoryKeyDown(event)) {
        return;
      }

      if (event.key === 'Tab' && !showFileDropdown && !showCommandMenu) {
        event.preventDefault();
        cyclePermissionMode();
        return;
      }

      if (event.key === 'Enter') {
        if (event.nativeEvent.isComposing) {
          return;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          event.preventDefault();
          handleSubmit(event);
        } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !sendByCtrlEnter) {
          event.preventDefault();
          handleSubmit(event);
        }
      }
    },
    [
      cyclePermissionMode,
      handleCommandMenuKeyDown,
      handleFileMentionsKeyDown,
      handleHistoryKeyDown,
      handleSubmit,
      sendByCtrlEnter,
      showCommandMenu,
      showFileDropdown,
    ],
  );

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      setCursorPosition(event.currentTarget.selectionStart);
    },
    [setCursorPosition],
  );

  const handleTextareaInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      resizeTextarea(target);
      setCursorPosition(target.selectionStart);
      syncInputOverlayScroll(target);
    },
    [resizeTextarea, setCursorPosition, syncInputOverlayScroll],
  );

  const handleClearInput = useCallback(() => {
    setInput('');
    inputValueRef.current = '';
    resetCommandMenuState();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    setIsTextareaExpanded(false);
  }, [resetCommandMenuState]);

  const handleAbortSession = useCallback(() => {
    if (!canAbortSession) {
      return;
    }

    const targetSessionId = selectedSession?.id || currentSessionId || null;
    if (!targetSessionId) {
      console.warn('Abort requested but no session ID is available.');
      return;
    }

    // The backend resolves the provider from the session row, so no provider
    // field is needed here.
    sendMessage({
      type: 'chat.abort',
      sessionId: targetSessionId,
    });
  }, [canAbortSession, currentSessionId, selectedSession?.id, sendMessage]);

  const submitResume = useCallback((content: string) => {
    handleSubmitRef.current?.(createFakeSubmitEvent(), { content, attachments: [] });
  }, []);
  // The restart's whole state machine lives in its own hook: it needs the abort, the submit and the
  // per-session processing flag, which are this hook's, and it needs to bind a pending restart to
  // ONE conversation and ONE run — which is more state than this file should grow.
  const { handleRestartOnInstalledCli, restartPending, restartingSessionId, restartedSessionId } = useRestartOnInstalledCli({
    sessionId: selectedSession?.id || currentSessionId || null,
    canAbort: canAbortSession,
    processingSessions,
    abort: handleAbortSession,
    submit: submitResume,
  });

  const handleGrantToolPermission = useCallback(
    (suggestion: { entry: string; toolName: string }) => {
      if (!suggestion || provider !== 'claude') {
        return { success: false };
      }
      return grantClaudeToolPermission(suggestion.entry);
    },
    [provider],
  );

  const handlePermissionDecision = useCallback(
    (
      requestIds: string | string[],
      decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
    ) => {
      const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
      const validIds = ids.filter(Boolean);
      if (validIds.length === 0) {
        return;
      }

      validIds.forEach((requestId) => {
        sendMessage({
          type: 'chat.permission-response',
          // The server reads only the request id; the session is for the socket's outbox, which
          // tells this conversation if the answer could not be delivered.
          sessionId: selectedSession?.id || currentSessionId || undefined,
          requestId,
          allow: Boolean(decision?.allow),
          updatedInput: decision?.updatedInput,
          message: decision?.message,
          rememberEntry: decision?.rememberEntry,
        });
      });

      setPendingPermissionRequests((previous) =>
        previous.filter((request) => !validIds.includes(request.requestId)),
      );
    },
    [currentSessionId, selectedSession?.id, sendMessage, setPendingPermissionRequests],
  );

  const [isInputFocused, setIsInputFocused] = useState(false);

  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      setIsInputFocused(focused);
    },
    [],
  );

  /** Loads an already-sent message back into the composer to be replaced. */
  const beginEditMessage = useCallback((message: ChatMessage) => {
    if (!message.transcriptAnchorId) return;
    setEditingAnchorId(message.transcriptAnchorId);
    setInput(message.content || '');
    inputValueRef.current = message.content || '';
    textareaRef.current?.focus();
  }, [setInput]);

  const cancelEditMessage = useCallback(() => {
    setEditingAnchorId(null);
    setInput('');
    inputValueRef.current = '';
  }, [setInput]);

  return {
    input,
    setInput,
    editingAnchorId,
    beginEditMessage,
    cancelEditMessage,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles: filteredFiles as MentionableFile[],
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedFiles,
    setAttachedFiles,
    fileErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openAttachmentPicker: open,
    handleSubmit,
    queuedDraft,
    editQueuedDraft,
    deleteQueuedDraft,
    handleVoiceTranscript,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handleRestartOnInstalledCli, restartPending, restartingSessionId, restartedSessionId,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
    commandModalPayload,
    closeCommandModal,
    showCostModal,
    compactConversation,
  };
}
