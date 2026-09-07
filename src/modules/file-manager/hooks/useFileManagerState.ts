import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { DirectoryListing, FilePreview } from '@/shared/types';

/** How many lines one preview asks for. The server clamps to 1-400 and says whether more exist. */
const PREVIEW_LINES = 200;

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
  // selected.
  const [selection, setSelection] = useState<{ projectId: string; path: string | null }>({ projectId, path: null });

  // Both are read back through the project, so switching projects opens the new one at its own root
  // with nothing selected. A path is only meaningful inside the project it was taken from: carried
  // across, it would have the pane report a refusal for a folder the reader never asked for here.
  const requestedDir = request.projectId === projectId ? request.dir : '';
  const selectedPath = selection.projectId === projectId ? selection.path : null;
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
  const previewSubject = `${projectId} ${selectedPath ?? ''}`;
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
        if (!cancelled) {
          setPreviewRead({ key: previewKey, subject: previewSubject, body, error });
        }
      };

      try {
        const response = await api.previewFile(projectId, selectedPath, PREVIEW_LINES);
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
  }, [previewKey, previewSubject, projectId, selectedPath]);

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

  const select = useCallback((path: string) => {
    setSelection({ projectId, path: toProjectRelative(path, projectPath) || null });
  }, [projectId, projectPath]);

  const refresh = useCallback(() => {
    setReloadNonce((previous) => previous + 1);
  }, []);

  return {
    currentDir,
    listing: shownListing?.listing ?? null,
    selectedPath,
    preview: shownPreview?.body ?? null,
    loading: settledListing === null,
    error: settledListing?.error ?? null,
    previewError: shownPreview?.error ?? null,
    enter,
    up,
    select,
    refresh,
  };
}
