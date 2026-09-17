import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { KanbanBoard } from '@/shared/kanban-types';
import { api, readApiJson } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';

/**
 * THE BOARD LIST AND THE ONE BOARD THIS PANEL IS LOOKING AT — the read side of the board chrome.
 *
 * BOARDS ARE GLOBAL. The selected board is a server-side setting, so switching projects never
 * switches boards and nothing here is filtered by project. `projectId` enters this hook for
 * exactly one purpose, stated once: the FIRST-MOUNT CONVENIENCE below.
 *
 * EVERY WRITE RE-READS. Selecting, renaming, archiving and flipping either of the board's two
 * switches all change what `listBoards` answers — an archived board drops out of the list, and the
 * selected board reads as null when the setting names one that is gone — so the panel takes its
 * next picture from the server rather than from a local guess about what the list became.
 */

type BoardListBody = { boards: KanbanBoard[]; currentBoardId: string | null };

/** What a board write may change. `projectId` is the label a NEW board carries, never a filter. */
export type KanbanBoardPatch = {
  name?: string;
  autonomy?: boolean;
  deepseekFlash?: boolean;
  projectId?: string | null;
  archived?: boolean;
};

export type KanbanBoards = {
  boards: KanbanBoard[];
  currentBoardId: string | null;
  /** The selected board's own setting. It gates the UI only; no write is ever skipped. */
  autonomy: boolean;
  /** The selected board's own DeepSeek switch: where this board's Metis, and every plan runner
   *  she starts, are billed. This panel only paints and writes it — nothing running is moved. */
  deepseekFlash: boolean;
  loading: boolean;
  /** A failed READ. Different news from a board with no cards — and from having no board. */
  unreachable: boolean;
  refresh: () => Promise<void>;
  selectBoard: (boardId: string) => Promise<void>;
  createBoard: (name: string) => Promise<void>;
  updateBoard: (boardId: string, patch: KanbanBoardPatch) => Promise<void>;
};

/** The message an `Error` carries, for a toast that must say what the server said. */
function reasonFor(error: unknown): string | undefined {
  if (error instanceof Error && error.message) return error.message;
  return undefined;
}

/**
 * WHAT ONE BOARD WRITE DID, IN WORDS — because none of the three is legible from the control that
 * caused it. A rename leaves the row looking like every other row, an archive takes the board out
 * of the list entirely, and either of the two switches shows its own new position without ever
 * saying the write landed.
 *
 * THE SENTENCE IS THE WHOLE OF IT. `ToastRequest` carries a title, a message and a tone and no
 * action slot, so there is no undo to hang here — and `src/shared/types.ts`, where that slot would
 * have to be added, is not this module's to open. Stating what happened is the entire contract; a
 * board archived by mistake is renamed back or re-made, and the cards were never touched.
 *
 * `undefined` for a patch that changes something else — a `projectId` relabel says nothing a
 * reader needs told.
 */
function saidFor(patch: KanbanBoardPatch, t: TFunction): string | undefined {
  if (patch.archived === true) return t('kanban.toast.boardArchived');
  if (patch.name !== undefined) return t('kanban.toast.boardRenamed');
  if (patch.autonomy !== undefined) {
    return patch.autonomy ? t('kanban.toast.autonomyOn') : t('kanban.toast.autonomyOff');
  }
  if (patch.deepseekFlash !== undefined) {
    return patch.deepseekFlash ? t('kanban.toast.deepseekFlashOn') : t('kanban.toast.deepseekFlashOff');
  }
  return undefined;
}

/**
 * The board list, the selected board, and the writes that change either.
 *
 * Called ONCE, by the panel. A second instance is a second `boards()` fetch, a second adopt-ref
 * and two `currentBoardId`s free to disagree the moment either one writes.
 */
export function useKanbanBoards(projectId: string): KanbanBoards {
  const { t } = useTranslation();
  const toast = useToast();

  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [currentBoardId, setCurrentBoardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);

  // A response landing after the tab is closed must not set state on a component that is gone.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The project the panel OPENED with. Switching projects is not a reason to adopt again, so the
  // mount value is kept here rather than read off the prop later — the one caller that needs it
  // is the first-mount lookup, and it runs before any switch could have happened.
  const openingProjectRef = useRef(projectId);
  // A new board is labelled with the project the reader is IN NOW, which is a different question
  // from the one above and is why the two are separate refs.
  const currentProjectRef = useRef(projectId);
  useEffect(() => {
    currentProjectRef.current = projectId;
  }, [projectId]);

  // Whether the first-mount lookup has already run. This is what makes it fire AT MOST ONCE per
  // mount: React effects and their async tails can both reach it, and without the latch a second
  // pass would select a board the reader has since chosen a different one over.
  const adoptedRef = useRef(false);

  const read = useCallback(async (): Promise<BoardListBody | null> => {
    try {
      const body = await readApiJson<BoardListBody>(await api.kanban.boards());
      if (!mountedRef.current) return null;
      setBoards(Array.isArray(body.boards) ? body.boards : []);
      setCurrentBoardId(body.currentBoardId ?? null);
      setUnreachable(false);
      return body;
    } catch (error) {
      // A read that failed is not a board that is empty: the panel paints an error and offers a
      // retry, and says nothing about how many cards there are.
      console.warn('[useKanbanBoards] the board list could not be read:', error);
      if (mountedRef.current) setUnreachable(true);
      return null;
    }
  }, []);

  /**
   * The ONE first-mount convenience. Boards are global and the project is a label, so the only
   * thing the project is ever asked for is this: on a first run, when nothing is selected, adopt
   * that project's board so the tab opens onto work rather than onto an empty state.
   *
   * It fires when the FIRST `boards()` answer comes back with no current board, it fires once,
   * and it is silent about a project that has no board — which is the ordinary answer, not a
   * failure.
   */
  const adoptProjectBoard = useCallback(
    async (project: string) => {
      try {
        const body = await readApiJson<{ board: KanbanBoard | null }>(await api.kanban.boardForProject(project));
        if (!body.board || !mountedRef.current) return;
        await readApiJson(await api.kanban.selectBoard(body.board.id));
        await read();
      } catch (error) {
        console.warn('[useKanbanBoards] the project\'s board could not be looked up:', error);
      }
    },
    [read]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    await read();
    if (mountedRef.current) setLoading(false);
  }, [read]);

  // The mount read, and the adoption that may follow it. Neither depends on `projectId`: the
  // prop is read once, above, and a project switch must not run any of this again.
  useEffect(() => {
    let cancelled = false;

    const begin = async () => {
      const body = await read();
      if (cancelled || !mountedRef.current) return;

      if (body && body.currentBoardId === null && !adoptedRef.current) {
        adoptedRef.current = true;
        await adoptProjectBoard(openingProjectRef.current);
      }

      if (mountedRef.current) setLoading(false);
    };

    void begin();
    return () => {
      cancelled = true;
    };
  }, [read, adoptProjectBoard]);

  const failBoardWrite = useCallback(
    (error: unknown) => {
      console.warn('[useKanbanBoards] the board write did not complete:', error);
      toast({ tone: 'warn', title: t('kanban.toast.boardNotSaved'), message: reasonFor(error) });
    },
    [t, toast]
  );

  const selectBoard = useCallback(
    async (boardId: string) => {
      try {
        const body = await readApiJson<{ currentBoardId: string }>(await api.kanban.selectBoard(boardId));
        if (!mountedRef.current) return;
        // Set from what the write RETURNED, so the lanes repaint from the server's answer rather
        // than from the id this panel happened to send.
        setCurrentBoardId(body.currentBoardId ?? boardId);
        await read();
      } catch (error) {
        failBoardWrite(error);
      }
    },
    [read, failBoardWrite]
  );

  const createBoard = useCallback(
    async (name: string) => {
      try {
        const body = await readApiJson<{ board: KanbanBoard }>(
          await api.kanban.createBoard({ name, projectId: currentProjectRef.current })
        );
        // The board you just made is the board you are looking at: creating one and leaving the
        // reader on the old one is a row that appears to have done nothing.
        await readApiJson(await api.kanban.selectBoard(body.board.id));
        await read();
        if (mountedRef.current) toast({ tone: 'positive', title: t('kanban.toast.boardCreated') });
      } catch (error) {
        failBoardWrite(error);
      }
    },
    [read, failBoardWrite, t, toast]
  );

  const updateBoard = useCallback(
    async (boardId: string, patch: KanbanBoardPatch) => {
      try {
        await readApiJson(await api.kanban.updateBoard(boardId, patch));
        await read();

        // Read AFTER the re-read, so the sentence describes a board list that already agrees with
        // it: an archive whose toast arrived before the board left the switcher would name a row
        // the reader can still see.
        const said = saidFor(patch, t);
        if (said && mountedRef.current) toast({ tone: 'positive', title: said });
      } catch (error) {
        failBoardWrite(error);
      }
    },
    [read, failBoardWrite, t, toast]
  );

  const autonomy = useMemo(
    () => boards.find((board) => board.id === currentBoardId)?.autonomy ?? false,
    [boards, currentBoardId]
  );

  // Read off the CURRENT BOARD for the same reason autonomy is: the switch paints the row's own
  // column, and `?? false` is what a board that is gone — or a server too old to answer with the
  // field — reads as, which is the position the switch was born in.
  const deepseekFlash = useMemo(
    () => boards.find((board) => board.id === currentBoardId)?.deepseekFlash ?? false,
    [boards, currentBoardId]
  );

  return {
    boards,
    currentBoardId,
    autonomy,
    deepseekFlash,
    loading,
    unreachable,
    refresh,
    selectBoard,
    createBoard,
    updateBoard,
  };
}
