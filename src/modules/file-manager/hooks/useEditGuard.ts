import { useCallback, useState } from 'react';

import {
  canSaveOpenEditSession,
  discardEditSession,
  getEditSessionStatus,
  saveOpenEditSession,
  startEditSession,
  useEditSessionStatus,
} from '@/modules/file-editor';

/**
 * The two questions the Files tab asks before a file takes another file's place.
 *
 * The app holds ONE edit session, so an open is never just an open: if the session is dirty and
 * holds a different file, opening the new one either saves the old text, drops it, or leaves the
 * reader where they were — and only the reader can say which. Every path into a file (the tree,
 * the listing, an open request from chat, git or the palette) therefore comes through
 * `guardedSelect`, and every path into the EDITOR comes through `requestEdit`, which asks the same
 * question when the session belongs to another project whose file this tab cannot even show.
 *
 * The pending asks are held HERE rather than in FileManager so the answer and the file it was
 * about cannot come apart: each is cleared in the same act that acts on it.
 */

/** The path a select was held back for, with the line it asked to land on. */
type PendingOpen = { path: string; line: number | undefined };

/** The file an Edit asked for while another project's session had unsaved changes. */
type PendingEdit = { path: string; anchorLine: number };

/** What FileManager wires into the tree, the listing, the preview pane and its two dialogs. */
type EditGuard = {
  /** Opens `path` at `line`, after settling whatever the open session has unsaved. */
  guardedSelect: (path: string, line?: number) => void;
  /** Opens `path` in the editor at `anchorLine`, after settling another project's session. */
  requestEdit: (path: string, anchorLine: number) => void;
  openGuardOpen: boolean;
  editGuardOpen: boolean;
  /** The file with unsaved changes, named in both questions. */
  dirtyName: string;
  /** The file the blocked Edit asked for. */
  editName: string;
  /** False when no editor is mounted to save through, so "Save and open" is not offered. */
  canSaveFirst: boolean;
  savingFirst: boolean;
  handleSaveAndOpen: () => void;
  handleDiscardAndOpen: () => void;
  handleDiscardAndEdit: () => void;
  handleKeepEditing: () => void;
};

/** The file's own name out of a project-relative path, for the copy the questions say. */
function fileNameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

/**
 * Consumed by FileManager alone, which is the one screen that opens files and edits them.
 *
 * `select` is the caller's "put this file on screen" — the file manager hands in one that also
 * walks the listing into the file's folder, so a deferred open lands in the right directory when
 * it finally happens rather than only when it was asked for.
 */
export function useEditGuard(
  projectId: string,
  select: (path: string, line?: number) => void,
): EditGuard {
  // The session as it stands, subscribed rather than read once: the questions' copy and the
  // "Save and open" answer both depend on whether that session is dirty right now.
  const session = useEditSessionStatus();
  const [pendingOpen, setPendingOpen] = useState<PendingOpen | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [savingFirst, setSavingFirst] = useState(false);

  const guardedSelect = useCallback((path: string, line?: number) => {
    // Read live rather than from the render's value: this is called from a click handler and from
    // the open-request effect, and both must see the session as it is at that instant.
    const live = getEditSessionStatus();
    // Only a DIRTY session on ANOTHER file of THIS project has anything to lose. A clean one is
    // replaced for free, and another project's file is not the file being opened.
    if (live === null || !live.dirty || live.projectId !== projectId || live.path === path) {
      select(path, line);
      return;
    }
    setPendingOpen({ path, line });
  }, [projectId, select]);

  const requestEdit = useCallback((path: string, anchorLine: number) => {
    const live = getEditSessionStatus();
    // Another project's unsaved text cannot be shown here, so letting the new session replace it
    // would drop edits off a screen the reader cannot get back to in this tab.
    if (live !== null && live.dirty && live.projectId !== projectId) {
      setPendingEdit({ path, anchorLine });
      return;
    }
    // This file already is the session — the restored document, its cursor and its scroll offset
    // are what the reader is coming back to, and starting a fresh session would throw them away.
    if (live !== null && live.projectId === projectId && live.path === path) {
      return;
    }
    startEditSession(projectId, path, anchorLine);
  }, [projectId]);

  const handleSaveAndOpen = useCallback(() => {
    if (pendingOpen === null) {
      return;
    }
    const { path, line } = pendingOpen;
    setSavingFirst(true);
    // Both answers clear the busy flag: a save that never answers (a dropped connection) would
    // otherwise leave the button reading "Save and open" as though it were still trying, with the
    // reader unable to ask again.
    const settle = (saved: boolean) => {
      setSavingFirst(false);
      // False means the write did not land — a conflict, a refusal, or no editor mounted to save
      // through. Opening the file anyway would leave the edits behind with nothing saying so, so
      // the question stays up and the reader answers it again.
      if (!saved) {
        return;
      }
      setPendingOpen(null);
      select(path, line);
    };
    void saveOpenEditSession().then(settle, () => settle(false));
  }, [pendingOpen, select]);

  const handleDiscardAndOpen = useCallback(() => {
    if (pendingOpen === null) {
      return;
    }
    const { path, line } = pendingOpen;
    setPendingOpen(null);
    discardEditSession();
    select(path, line);
  }, [pendingOpen, select]);

  const handleDiscardAndEdit = useCallback(() => {
    if (pendingEdit === null) {
      return;
    }
    const { path, anchorLine } = pendingEdit;
    setPendingEdit(null);
    discardEditSession();
    startEditSession(projectId, path, anchorLine);
  }, [pendingEdit, projectId]);

  // One answer backs out of either question, and it is the same answer: the reader keeps their
  // edits. Which question was up decides the rest — a held-back open leaves the session's file on
  // screen, while a held-back Edit names another project's file and moves nothing here.
  const handleKeepEditing = useCallback(() => {
    const heldAnOpen = pendingOpen !== null;
    setPendingOpen(null);
    setPendingEdit(null);
    const live = getEditSessionStatus();
    if (heldAnOpen && live !== null) {
      select(live.path);
    }
  }, [pendingOpen, select]);

  return {
    guardedSelect,
    requestEdit,
    openGuardOpen: pendingOpen !== null,
    editGuardOpen: pendingEdit !== null,
    dirtyName: session === null ? '' : fileNameOf(session.path),
    editName: pendingEdit === null ? '' : fileNameOf(pendingEdit.path),
    canSaveFirst: canSaveOpenEditSession(),
    savingFirst,
    handleSaveAndOpen,
    handleDiscardAndOpen,
    handleDiscardAndEdit,
    handleKeepEditing,
  };
}
