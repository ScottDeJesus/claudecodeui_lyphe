import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { DirectoryListing, FilePreview } from '@/shared/types';

/** How many lines one preview asks for. The server clamps to 1-400 and says whether more exist. */
const PREVIEW_LINES = 200;

/**
 * How far ABOVE a targeted line the window opens.
 *
 * The window is not centred on the line and is not meant to be: a reader arriving at
 * `foo.ts:412` wants the lines that lead UP to it as context and the rest of the function
 * below it, so 40 lines of lead-in and ~160 of follow-on is the shape that reads. It is also
 * why the clamp is a subtraction and not a division — nothing here knows how long the file is,
 * and `totalLines` is `null` for a large one, so a proportional window could not be computed
 * without a second read.
 */
const PREVIEW_CONTEXT_LINES = 40;

/** What one settled read left behind: the thing asked for, and either the body or the refusal. */
type ReadResult<T> = { key: string; subject: string; body: T | null; error: string | null };

/** Reads the server's own sentence off a refusal, falling back to the status when the body says nothing. */
async function readRefusal(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === 'string' && body.error) {
      return body.error;
    }
  } catch {
    // A non-JSON refusal (a proxy, a crash page) carries nothing worth quoting.
  }
  return `${fallback} (${response.status})`;
}

/**
 * Puts a path from anywhere in the app into the one form this hook holds: relative to the
 * project root, `''` for the root itself.
 *
 * The three caller families spell a path three ways — the tree and the chat cards hand over an
 * absolute path, the git panel one already relative to the repository root — and the server's own
 * `DirectoryListing.path` is the resolved ABSOLUTE directory. All of them arrive here. Nothing is
 * FILTERED on the way through: a path that climbs out of the project is sent as it came, and the
 * server's 403 is what refuses it.
 */
function toProjectRelative(path: string, projectPath: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const root = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');

  if (root && normalized === root) {
    return '';
  }
  if (root && normalized.startsWith(`${root}/`)) {
    return normalized.slice(root.length + 1);
  }
  return normalized.replace(/^\.?\/+/, '');
}

/** The directory one level up from a project-relative path; `''` (the root) has none. */
function parentOf(directory: string): string {
  return directory.split('/').slice(0, -1).join('/');
}

/**
 * Everything the file manager knows about where it is and what it is showing: the directory in
 * view, its listing, the selected file and that file's preview.
 *
 * Used by the file-manager module's `FileManager` alone. It is a hook rather than state inside
 * that component because the two reads have to be gated on their own inputs — a listing read that
 * re-fired on every render would re-read the directory each time a preview arrived.
 *
 * Each read stores ONE record when it settles, and everything the panes show is derived from it.
 * That is what lets a re-read of the same directory keep its rows on screen while walking into a
 * new one clears them, without a second flag to keep in step.
 */
export function useFileManagerState(projectId: string, projectPath: string) {
  // The directory the listing is being READ for, and the project it was asked for in. Separate from
  // `currentDir` below, which is the directory the server says it actually read: only this one may
  // drive the read, or the answer would feed its own request.
  const [request, setRequest] = useState({ projectId, dir: '' });
  // The file the preview pane is showing, project-relative, and its project. Null means nothing is
  // selected. `line` is the line a caller asked to land on (null when it asked for the file plainly),
  // and `nonce` counts the ASKS: re-opening the same file at the same line is a fresh request that
  // must re-read and re-scroll, and every other field would be identical to the last one.
  const [selection, setSelection] = useState<{
    projectId: string;
    path: string | null;
    line: number | null;
    nonce: number;
  }>({ projectId, path: null, line: null, nonce: 0 });

  // Both are read back through the project, so switching projects opens the new one at its own root
  // with nothing selected. A path is only meaningful inside the project it was taken from: carried
  // across, it would have the pane report a refusal for a folder the reader never asked for here.
  const requestedDir = request.projectId === projectId ? request.dir : '';
  const selectedPath = selection.projectId === projectId ? selection.path : null;
  // Read back through the project for the same reason the path is: a line belongs to the file it
  // was named against, and carrying it into another project would scroll to a line nobody asked for.
  const askedLine = selection.projectId === projectId ? selection.line : null;
  const targetNonce = selection.projectId === projectId ? selection.nonce : 0;
  // The ONE ask whose line turned out to be past the end of its file. A chat reference is parsed
  // out of model prose, so a stale or invented line is ordinary, and a window past the end answers
  // honestly with nothing — leaving a blank pane for a file that is right there. Recording the ask
  // falls the window back to the top; keying it by ASK keeps a later real line in the same file.
  const [pastEndAsk, setPastEndAsk] = useState<string | null>(null);
  const askSubject = `${projectId} ${selectedPath ?? ''} ${targetNonce}`;
  const lineMissed = pastEndAsk === askSubject;
  const targetLine = lineMissed ? null : askedLine;
  const missedLine = lineMissed ? askedLine : null;
  // Where the window opens. Floored at 1 so a reference to line 3 reads from the top rather than
  // asking the server for line -37 and leaning on its clamp to mean the same thing.
  const previewStart = targetLine === null ? 1 : Math.max(1, targetLine - PREVIEW_CONTEXT_LINES);
  // Bumped by `refresh()`. A counter rather than a flag because two refreshes in a row must both
  // re-run the reads, and a boolean put back to the same value would not.
  const [reloadNonce, setReloadNonce] = useState(0);
  // The last settled listing read, tagged with what it was for. Everything the listing pane shows
  // is read off this one record rather than off a separate loading/error/data trio.
  const [listingRead, setListingRead] = useState<ReadResult<DirectoryListing> | null>(null);
  // The last directory a listing actually CAME BACK for, and its rows. Kept beside the read above
  // because a refusal does not move anybody: the breadcrumb has to keep naming where the reader
  // still is, and naming the folder the server would not open is a claim the app cannot make.
  // It carries BOTH the project it came from and its full subject, because the two places it stands
  // in need different granularity — see `shownListing`.
  const [resolved, setResolved] = useState<
    { projectId: string; subject: string; dir: string; listing: DirectoryListing } | null
  >(null);
  // The same, for the preview.
  const [previewRead, setPreviewRead] = useState<ReadResult<FilePreview> | null>(null);

  // What each read is FOR, project included: this pane stays mounted across a project switch with
  // `requestedDir` still `''`, so a subject of the directory alone would let the previous project's
  // rows stand under the new project's name until the new read landed.
  const listingSubject = `${projectId} ${requestedDir}`;
  // The WINDOW is part of what a preview read is for, not just the file: the same file at a new
  // line is different content and must re-read rather than show the old window under the new
  // target. The ask COUNTER is deliberately NOT here — re-asking for a window already on screen is
  // the same bytes, and keying on it blanked the pane to "Reading…" on every repeat click of an
  // already-selected row. Re-scrolling an unchanged window is the pane's job, via `targetNonce`.
  const previewSubject = `${projectId} ${selectedPath ?? ''} ${previewStart}`;
  // The subject plus the refresh counter: what one read is for, and which time round it is.
  const listingKey = `${listingSubject} ${reloadNonce}`;
  const previewKey = `${previewSubject} ${reloadNonce}`;

  useEffect(() => {
    if (!projectId) {
      return undefined;
    }

    let cancelled = false;

    void (async () => {
      const settle = (body: DirectoryListing | null, error: string | null) => {
        if (cancelled) {
          return;
        }
        setListingRead({ key: listingKey, subject: listingSubject, body, error });
        if (body) {
          setResolved({
            projectId,
            subject: listingSubject,
            dir: toProjectRelative(body.path, projectPath),
            listing: body,
          });
        }
      };

      try {
        const response = await api.listDirectory(projectId, requestedDir);
        if (!response.ok) {
          settle(null, await readRefusal(response, 'This folder could not be read'));
          return;
        }
        settle(await response.json() as DirectoryListing, null);
      } catch (cause) {
        settle(null, cause instanceof Error ? cause.message : 'This folder could not be read');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [listingKey, listingSubject, projectId, projectPath, requestedDir]);

  useEffect(() => {
    if (!projectId || !selectedPath) {
      return undefined;
    }

    let cancelled = false;

    void (async () => {
      const settle = (body: FilePreview | null, error: string | null) => {
        if (cancelled) {
          return;
        }
        setPreviewRead({ key: previewKey, subject: previewSubject, body, error });
        // An empty window that did not start at the top: the line asked for is past the end of the
        // file. Fall back to the top so the file is READ rather than reported as nothing. The
        // `startLine > 1` guard is what terminates it — the retry opens at 1 and cannot re-trigger.
        if (body?.kind === 'text' && body.lines.length === 0 && body.startLine > 1) {
          setPastEndAsk(askSubject);
        }
      };

      try {
        const response = await api.previewFile(projectId, selectedPath, PREVIEW_LINES, previewStart);
        if (!response.ok) {
          settle(null, await readRefusal(response, 'This file could not be read'));
          return;
        }
        settle(await response.json() as FilePreview, null);
      } catch (cause) {
        settle(null, cause instanceof Error ? cause.message : 'This file could not be read');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [askSubject, previewKey, previewStart, previewSubject, projectId, selectedPath]);

  // A read that settled for exactly this request; anything else is either in flight or older.
  const settledListing = listingRead?.key === listingKey ? listingRead : null;

  /**
   * What the listing pane shows, and where the breadcrumb says the reader is.
   *
   * The last resolved directory stands in for two of the three states, and for the same reason
   * both times — a read that did not come back does not move anybody:
   *  - REFUSED: the pane keeps the rows and the crumb of the folder the reader is still in, and the
   *    refusal is said beside them. Falling back to what was ASKED FOR would have the crumb name a
   *    folder the server just declined to open. The guard here is the PROJECT and not the full
   *    subject, because a refusal's subject IS the refused directory and never the resolved one —
   *    but it must still be a guard: rows from another project under this project's name would say
   *    whose files these are, wrongly, with sizes and dates that make them look verified.
   *  - RE-READ of the same directory (a refresh after an upload): the rows stay up instead of
   *    blinking away and back. That one takes the full subject, project included.
   * Walking into a NEW directory is the third state and keeps nothing: neither guard matches, so
   * the pane empties and says it is reading. A project whose root refuses lands there too — nothing
   * of this project has resolved, so there is nothing honest to show but the refusal.
   */
  const shownListing = settledListing?.body
    ? { dir: toProjectRelative(settledListing.body.path, projectPath), listing: settledListing.body }
    : ((settledListing?.error && resolved?.projectId === projectId)
      || resolved?.subject === listingSubject ? resolved : null);

  const settledPreview = previewRead?.key === previewKey ? previewRead : null;
  const shownPreview = settledPreview ?? (previewRead?.subject === previewSubject ? previewRead : null);

  // The server's resolved directory is what the breadcrumb reads, so a path that went through a
  // symlink says where it landed rather than where it was asked for. A refusal with nothing ever
  // resolved reads as the project root — the app got nowhere, and says so rather than naming the
  // folder it was turned away from.
  const currentDir = shownListing ? shownListing.dir : (settledListing?.error ? '' : requestedDir);

  const enter = useCallback((directory: string) => {
    setRequest({ projectId, dir: toProjectRelative(directory, projectPath) });
  }, [projectId, projectPath]);

  const up = useCallback(() => {
    setRequest({ projectId, dir: parentOf(currentDir) });
  }, [currentDir, projectId]);

  const select = useCallback((path: string, line?: number) => {
    setSelection((previous) => ({
      projectId,
      path: toProjectRelative(path, projectPath) || null,
      line: line ?? null,
      nonce: previous.nonce + 1,
    }));
  }, [projectId, projectPath]);

  const refresh = useCallback(() => {
    setReloadNonce((previous) => previous + 1);
  }, []);

  return {
    currentDir,
    listing: shownListing?.listing ?? null,
    selectedPath,
    preview: shownPreview?.body ?? null,
    // The line the preview pane should mark and scroll to, or null when nobody named one. It is
    // the SELECTION's line rather than the settled read's, so it is right on the first frame the
    // new preview renders in.
    targetLine,
    // Which ASK this is: the pane re-scrolls on it, so asking twice lands the reader back on the
    // line with no re-read. `missedLine` is a line that turned out not to exist, once the window
    // has fallen back to the top — the pane says so rather than leaving line 1 unexplained.
    targetNonce,
    missedLine,
    loading: settledListing === null,
    error: settledListing?.error ?? null,
    previewError: shownPreview?.error ?? null,
    enter,
    up,
    select,
    refresh,
  };
}
