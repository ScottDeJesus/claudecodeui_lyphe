import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '@/shared/api';
import type { ChatImage, ChatMessage } from '@/shared/types';
import { parseToolPayload } from '@/modules/chat/utils/messageTransforms';

/** One `Read` that returned a picture: the picture, and when the call was made (`Infinity` when the row carries no usable time). */
type PictureRead = { image: ChatImage; at: number };

/**
 * What a chat's own transcript holds for the pictures its words name by a path outside the project.
 *
 * `byPath` maps the `file_path` of every `Read` that returned a raster picture, with its `.` / `..` / `//` folded away
 * (`resolveDots`, the fold the lookup applies to the path a reply names), to those reads, oldest first. Each
 * picture is the copy the agent saw (`ChatImage`: an inline data URL on a live frame, or a path into the global chat
 * assets on a history load, which stores each tool-result picture there by the hash of its bytes). A reply that says
 * `![shot](/tmp/shot.png)` or `` `/tmp/shot.png` `` is drawn from that copy: the file itself lives where the file tree
 * refuses to read, and may be gone by the time the reply is read.
 */
type TranscriptPictures = {
  /** The project's absolute folder, or null before it is known. A path under it is a project file, not an outside one. */
  projectRoot: string | null;
  /**
   * The folder the file tree serves files from besides the project (the server's workspace root), `undefined` while it
   * is being read and `null` when it could not be: an unreadable root decides nothing, and a path is asked for as it
   * always was.
   */
  workspaceRoot: string | null | undefined;
  /** Every page of the transcript is loaded, so no `Read` can sit on an older one: only then is "no copy" a fact. */
  complete: boolean;
  byPath: ReadonlyMap<string, readonly PictureRead[]>;
};

/**
 * Provided by `ChatMessagesPane` around the transcript it draws; read through `useOutsideImage`.
 * `null` everywhere else (an export, a fixture, another surface's markdown), where an image keeps the
 * way it was always drawn.
 */
export const TranscriptPicturesContext = createContext<TranscriptPictures | null>(null);

/**
 * When the message being drawn was written (ms), provided by `MessageComponent`. A reply is drawn from the
 * newest `Read` of its path at or before this time, so a screenshot overwritten and read again later does not
 * change what an earlier reply showed. `null` outside a message: the newest read stands.
 */
export const MessageTimeContext = createContext<number | null>(null);

/** A data URL of a raster type a browser draws safely. SVG is a document that can run script: never one of these. */
const RASTER_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,/;
/** The extension a stored tool-result picture carries: `storeToolResultImages` writes only these four. */
const RASTER_FILE_NAME = /\.(?:png|jpe?g|gif|webp)$/i;

/** `path` as the server resolves it: repeated slashes and `.` / `..` segments folded away. Only for deciding where a path points. */
function resolveDots(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

const isUnder = (resolvedPath: string, folder: string): boolean =>
  folder === '/' || resolvedPath === folder || resolvedPath.startsWith(`${folder}/`);

const isRasterPicture = (image: ChatImage): boolean =>
  image.data ? RASTER_DATA_URL.test(image.data) : Boolean(image.path && RASTER_FILE_NAME.test(image.path));

/** The `file_path` a `Read` call was made with, or null for a call that names none. */
const readFilePath = (message: ChatMessage): string | null => {
  const payload = parseToolPayload(message.toolInput);
  if (typeof payload !== 'object' || payload === null || !('file_path' in payload)) return null;
  const filePath = (payload as { file_path: unknown }).file_path;
  return typeof filePath === 'string' && filePath !== '' ? filePath : null;
};

/**
 * The `Read` pictures of a transcript, by the folded path each was called with, each path's reads oldest first.
 *
 * The key is folded because the lookup folds: a `Read` of `/opt/x/e4.png` and a reply naming `/opt/x/./sub/../e4.png`
 * are one file. A `Read` that errored carries no picture and is skipped; so is one whose picture is not a raster type,
 * and one called with a relative path, which is never asked about (`useOutsideImage` answers only absolute paths).
 * Only this chat's own messages are read, never another chat's.
 */
function indexReadPictures(messages: readonly ChatMessage[]): Map<string, PictureRead[]> {
  const byPath = new Map<string, PictureRead[]>();
  for (const message of messages) {
    if (message.toolName !== 'Read' || message.toolResult?.isError) continue;
    const image = message.toolResult?.images?.find(isRasterPicture);
    const filePath = image ? readFilePath(message) : null;
    if (!image || !filePath?.startsWith('/')) continue;
    const foldedPath = resolveDots(filePath);
    const at = new Date(message.timestamp).getTime();
    const reads = byPath.get(foldedPath) ?? [];
    reads.push({ image, at: Number.isNaN(at) ? Number.POSITIVE_INFINITY : at });
    byPath.set(foldedPath, reads);
  }
  return byPath;
}

/**
 * The picture the message written at `at` is about: the newest `Read` of the path at or before that time (a screenshot
 * is overwritten run after run, and each reply is about the one the agent had just seen), else the oldest after it;
 * the newest when the message's time is unknown.
 */
function pictureFor(reads: readonly PictureRead[], at: number | null): ChatImage {
  if (at === null) return reads[reads.length - 1].image;
  let chosen: PictureRead | undefined;
  for (const read of reads) {
    if (read.at <= at) chosen = read;
  }
  return (chosen ?? reads[0]).image;
}

/** The settled answer of `readWorkspaceRoot`, kept so a chat that mounts later starts with it instead of waiting a tick. */
let settledWorkspaceRoot: string | null | undefined;
let workspaceRootRead: Promise<string | null> | null = null;

/**
 * The server's workspace root, read once per page from the file tree's own `browse-filesystem` answer: asked for
 * no folder it answers the root itself (`path`, symlinks resolved). The file tree serves a file under the project or
 * under that root and refuses every other absolute path, so the root is what tells a path it will refuse from one it
 * will serve. A failed read answers `null` and is not kept: the next chat to mount asks again.
 */
function readWorkspaceRoot(): Promise<string | null> {
  if (!workspaceRootRead) {
    workspaceRootRead = api.browseFilesystem(null)
      .then(async (response) => (response.ok ? ((await response.json()) as { path?: unknown }).path : null))
      .then((root) => (typeof root === 'string' && root.startsWith('/') ? resolveDots(root) : null))
      .catch(() => null);
    void workspaceRootRead.then((root) => {
      settledWorkspaceRoot = root;
      if (root === null) workspaceRootRead = null;
    });
  }
  return workspaceRootRead;
}

function useWorkspaceRoot(): string | null | undefined {
  // The root the server serves besides the project, read once for the page: without it a client cannot tell a path the file tree will refuse from one it will serve.
  const [root, setRoot] = useState<string | null | undefined>(settledWorkspaceRoot);
  useEffect(() => {
    let cancelled = false;
    void readWorkspaceRoot().then((value) => {
      if (!cancelled) setRoot(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return root;
}

/**
 * The value `TranscriptPicturesContext` provides for a chat: its `Read` pictures, its project's folder, the workspace
 * root, and whether every page of the transcript is loaded.
 *
 * Used by `ChatMessagesPane`, with the whole loaded transcript (not only the rows on screen: a `Read`
 * above the visible window still counts). A `Read` on a history page that has not loaded yet is not seen, so
 * `complete` is false until every page is in, and until then a path with no copy is not captioned.
 */
export function useTranscriptPictures(
  messages: readonly ChatMessage[],
  { projectRoot, complete }: { projectRoot: string | null; complete: boolean },
): TranscriptPictures {
  const byPath = useMemo(() => indexReadPictures(messages), [messages]);
  const workspaceRoot = useWorkspaceRoot();
  return useMemo(
    () => ({ projectRoot, workspaceRoot, complete, byPath }),
    [projectRoot, workspaceRoot, complete, byPath],
  );
}

/** What the chat knows about one path it names. */
type OutsideImage = {
  /** The transcript's own copy of a picture at this path, or null. */
  picture: ChatImage | null;
  /** Ask the file tree for nothing: the path is one it refuses, or may be until the workspace root is known. */
  refused: boolean;
  /** The refusal is certain: the root is known, and the path is outside it and outside the project. */
  certain: boolean;
  /** Say so on screen: certain, with no copy, and every page of the transcript loaded so none can hold one. */
  captioned: boolean;
  /** A file on this machine's disk the chat can name: under the project, under the workspace root, or one it holds a copy of. */
  local: boolean;
};

const NOT_OUTSIDE: OutsideImage = { picture: null, refused: false, certain: false, captioned: false, local: false };
const LOCAL: OutsideImage = { ...NOT_OUTSIDE, local: true };

/**
 * What the chat holds for `path`, an absolute path the chat's words name (null: not an absolute path).
 *
 * Used by `useFilePreview` (a chip's preview), `MarkdownImage` (which decides whether a root-relative
 * image is a path on this machine) and `ChatMessageImages` (which skips the file-tree fallback for a
 * path it is certain to refuse). A relative path and any path outside a chat transcript answer "nothing":
 * those keep their existing way of being drawn, and so does a path under the project or the workspace
 * root, which the file tree serves.
 */
export function useOutsideImage(path: string | null): OutsideImage {
  const pictures = useContext(TranscriptPicturesContext);
  const at = useContext(MessageTimeContext);
  return useMemo(() => {
    if (!pictures || !path || !path.startsWith('/')) return NOT_OUTSIDE;
    const { projectRoot, workspaceRoot, complete, byPath } = pictures;
    const resolved = resolveDots(path);
    if (projectRoot && isUnder(resolved, resolveDots(projectRoot))) return LOCAL;
    const reads = byPath.get(resolved);
    if (reads) return { ...LOCAL, picture: pictureFor(reads, at) };
    if (workspaceRoot === null) return NOT_OUTSIDE;
    if (workspaceRoot !== undefined && isUnder(resolved, workspaceRoot)) return LOCAL;
    const certain = workspaceRoot !== undefined;
    return { picture: null, refused: true, certain, captioned: certain && complete, local: false };
  }, [pictures, path, at]);
}

/** The bytes of a data URL as a Blob typed by it, or null when it is not a raster base64 one. */
function blobOfDataUrl(dataUrl: string): Blob | null {
  const header = RASTER_DATA_URL.exec(dataUrl);
  if (!header) return null;
  const binary = atob(dataUrl.slice(header[0].length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: header[0].slice('data:'.length, header[0].indexOf(';')) });
}

/** Stored copies the assets route did not have, kept for the page so a remount does not ask (and log a 404) again. */
const missingStoredCopies = new Set<string>();

/**
 * The bytes of a transcript picture: decoded in place from a data URL, or read from the global chat
 * assets (`/api/assets/images/<name>`, the same route `ChatMessageImages` draws a stored picture
 * through) for one a history load stored. Null when the copy cannot be read (an asset since cleaned).
 * Never reads the path the picture was named by.
 */
export async function readTranscriptPicture(picture: ChatImage): Promise<Blob | null> {
  if (picture.data) return blobOfDataUrl(picture.data);
  const storedName = picture.path?.split(/[\\/]/).pop();
  if (!storedName || missingStoredCopies.has(storedName)) return null;
  const response = await api.assets.image(storedName);
  if (!response.ok) {
    missingStoredCopies.add(storedName);
    return null;
  }
  return response.blob();
}
