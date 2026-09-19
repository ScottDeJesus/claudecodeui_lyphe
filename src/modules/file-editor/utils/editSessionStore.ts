import { useSyncExternalStore } from 'react';

import type { EditSessionRecord, EditSessionStatus } from '@/shared/types';

/**
 * The one edit session the app holds.
 *
 * One file can be open for editing at a time, and that session outlives the component that shows
 * it: the editor's whole CodeMirror state lives HERE between unmounts, so closing the editor and
 * opening the same file again comes back to the same text, the same cursor and the same scroll
 * offset with no refetch. The file manager reads the status to know whether a file has unsaved
 * changes before it lets another file take its place.
 *
 * CodeMirror is imported for types only, so this module — which the file manager's eager chunk
 * pulls in — never drags the editor itself into the first page load.
 */

/** The live session, or null when no file is open for editing. */
let session: EditSessionRecord | null = null;

/**
 * The status object handed to React. Held rather than rebuilt, because `useSyncExternalStore`
 * compares snapshots by identity and a fresh object every read would loop forever.
 */
let statusSnapshot: EditSessionStatus | null = null;

const listeners = new Set<() => void>();

/** The mounted editor's save function; null while no editor is mounted. */
let saveHandler: (() => Promise<boolean>) | null = null;

/** True while the `beforeunload` guard below is attached. */
let unloadGuardAttached = false;

/** Warns before a reload or a tab close that would throw away unsaved edits. */
function onBeforeUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = '';
}

/**
 * Attaches the unload guard only while there is something to lose, so a clean session never
 * shows the browser's "leave site?" prompt — which it would, guard or no guard, if the listener
 * stayed attached.
 */
function syncUnloadGuard(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const needed = session !== null && session.dirty;
  if (needed === unloadGuardAttached) {
    return;
  }
  if (needed) {
    window.addEventListener('beforeunload', onBeforeUnload);
  } else {
    window.removeEventListener('beforeunload', onBeforeUnload);
  }
  unloadGuardAttached = needed;
}

/** The public shape of a record, so a caller cannot mutate the session by holding the object. */
function toStatus(record: EditSessionRecord): EditSessionStatus {
  return {
    projectId: record.projectId,
    path: record.path,
    anchorLine: record.anchorLine,
    dirty: record.dirty,
  };
}

/** Publishes a new session value to the status snapshot, the unload guard and every subscriber. */
function commit(next: EditSessionRecord | null): void {
  session = next;
  statusSnapshot = next === null ? null : toStatus(next);
  syncUnloadGuard();
  for (const listener of [...listeners]) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Opens a session on `projectId`/`path`, replacing whatever session was open.
 *
 * Callers reach for this only when there is no stored record for the file — a record already in
 * the store IS the live session, and replacing it would drop the text the user has not saved.
 */
export function startEditSession(projectId: string, path: string, anchorLine: number): void {
  commit({ projectId, path, anchorLine, dirty: false, state: null, scrollTop: 0 });
}

/** The session's status, or null; the subscription a component uses to re-render on change. */
export function useEditSessionStatus(): EditSessionStatus | null {
  return useSyncExternalStore(subscribe, getEditSessionStatus);
}

/** The same status outside React, stable by identity until the session actually changes. */
export function getEditSessionStatus(): EditSessionStatus | null {
  return statusSnapshot;
}

/**
 * Hands the store the mounted editor's save function, so the file manager can save the open file
 * before it opens another one. `null` clears it on unmount.
 */
export function registerSaveHandler(handler: (() => Promise<boolean>) | null): void {
  saveHandler = handler;
}

/** True when saving the open session is possible: it is dirty and an editor is mounted. */
export function canSaveOpenEditSession(): boolean {
  return session !== null && session.dirty && saveHandler !== null;
}

/** Saves the open session through its editor; resolves false when there is nothing to save to. */
export function saveOpenEditSession(): Promise<boolean> {
  const handler = saveHandler;
  if (session === null || !session.dirty || handler === null) {
    return Promise.resolve(false);
  }
  return handler();
}

/** Clears the session after the user chose to drop its edits and move on. */
export function discardEditSession(): void {
  commit(null);
}

/** Clears the session after a clean or saved close. */
export function endEditSession(): void {
  commit(null);
}

/** The stored record for exactly this file, or null — the "is this session already open" read. */
export function readEditSession(projectId: string, path: string): EditSessionRecord | null {
  if (session === null || session.projectId !== projectId || session.path !== path) {
    return null;
  }
  return session;
}

/**
 * Updates the live session — the editor's state on unmount, its scroll offset, its dirty flag.
 *
 * A write naming another project or path is dropped: when one editor is torn down in the same
 * commit that opens the next file, its unmount must not write its own state into the new
 * session.
 */
export function writeEditSession(patch: Partial<EditSessionRecord>): void {
  if (session === null) {
    return;
  }
  if (patch.projectId !== undefined && patch.projectId !== session.projectId) {
    return;
  }
  if (patch.path !== undefined && patch.path !== session.path) {
    return;
  }
  commit({ ...session, ...patch });
}
