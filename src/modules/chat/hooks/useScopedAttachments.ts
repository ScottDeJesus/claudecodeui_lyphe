import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

/**
 * Files picked, dropped or pasted into a chat's composer and not sent yet, per draft scope (a
 * session id, or `project:<id>` for a chat not sent yet — the scope the composer text is kept
 * under). Module-level, so switching chats and back finds them again. In memory only: a `File`
 * cannot be written to the draft store, so unlike the text they do not survive a reload.
 */
const attachmentsByScope = new Map<string, File[]>();

const NO_FILES: File[] = [];

function remember(scope: string, files: File[]): void {
  if (files.length > 0) {
    attachmentsByScope.set(scope, files);
  } else {
    attachmentsByScope.delete(scope);
  }
}

/**
 * The composer's attachments for the chat on screen. They used to be one list for the whole
 * composer, so a photo attached in one chat was still attached after switching to another, while
 * the text beside it swapped correctly.
 *
 * The state carries the scope it was set for, the way the composer's text does: on a switch there
 * is one render where the scope has moved and the state has not, and reading another chat's files
 * in that render is the bug this exists to prevent.
 */
export function useScopedAttachments(scope: string | null): {
  attachedFiles: File[];
  setAttachedFiles: Dispatch<SetStateAction<File[]>>;
  clearAttachmentsFor: (scope: string | null) => void;
  fileErrors: Map<string, string>;
  setFileErrors: Dispatch<SetStateAction<Map<string, string>>>;
} {
  const [state, setState] = useState<{ scope: string | null; files: File[] }>(() => ({
    scope,
    files: scope ? attachmentsByScope.get(scope) ?? NO_FILES : NO_FILES,
  }));
  // Size and read errors name files of the chat they were raised in, so they do not follow a switch.
  const [errors, setErrors] = useState<{ scope: string | null; map: Map<string, string> }>(() => ({
    scope,
    map: new Map(),
  }));
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => {
    setState((previous) => (previous.scope === scope
      ? previous
      : { scope, files: scope ? attachmentsByScope.get(scope) ?? NO_FILES : NO_FILES }));
  }, [scope]);

  const setAttachedFiles = useCallback<Dispatch<SetStateAction<File[]>>>((next) => {
    setState((previous) => {
      const target = scopeRef.current;
      const base = previous.scope === target
        ? previous.files
        : target ? attachmentsByScope.get(target) ?? NO_FILES : NO_FILES;
      const files = typeof next === 'function' ? next(base) : next;
      if (target) remember(target, files);
      return { scope: target, files };
    });
  }, []);

  /**
   * Empties one scope's attachments, whichever chat is on screen now. A send reads its files, then
   * awaits an upload; a switch during that wait must not have the send clear the next chat's files,
   * nor leave its own behind.
   */
  const clearAttachmentsFor = useCallback((target: string | null) => {
    if (!target) return;
    attachmentsByScope.delete(target);
    setState((previous) => (previous.scope === target ? { scope: target, files: NO_FILES } : previous));
    setErrors((previous) => (previous.scope === target ? { scope: target, map: new Map() } : previous));
  }, []);

  const setFileErrors = useCallback<Dispatch<SetStateAction<Map<string, string>>>>((next) => {
    setErrors((previous) => {
      const target = scopeRef.current;
      const base = previous.scope === target ? previous.map : new Map<string, string>();
      return { scope: target, map: typeof next === 'function' ? next(base) : next };
    });
  }, []);

  return {
    attachedFiles: state.scope === scope ? state.files : scope ? attachmentsByScope.get(scope) ?? NO_FILES : NO_FILES,
    setAttachedFiles,
    clearAttachmentsFor,
    fileErrors: errors.scope === scope ? errors.map : EMPTY_ERRORS,
    setFileErrors,
  };
}

const EMPTY_ERRORS = new Map<string, string>();
