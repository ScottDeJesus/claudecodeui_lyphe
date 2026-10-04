/**
 * Claude's base64 `image` content blocks, read out of a transcript row.
 *
 * An image reaches a row from two directions: the user attaches one to a prompt, and a tool hands
 * one back (a `Read` of a picture, an MCP screenshot). In both the CLI stores the same block —
 * `{ type: 'image', source: { type: 'base64', media_type, data } }` — and the chat draws it from
 * the `{ data: 'data:<media_type>;base64,<data>' }` shape (`ChatImage`).
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, access, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getGlobalImageAssetsDir, toPosixPath } from '@/shared/image-attachments.js';
import type { AnyRecord, NormalizedMessage } from '@/shared/types.js';

/** A displayable image as the chat carries it: an inline data URL, or (after `storeToolResultImages`) the path of the asset holding its bytes. */
type InlineImage = { data?: string; path?: string };

/**
 * The data URL of one base64 image block, or null when the part is anything else.
 *
 * Used by this module's tool-result reader and by `claude-sessions.provider` for the images a user
 * attaches to a prompt, so both directions build the URL by the same rule.
 */
export function readImageBlockDataUrl(part: unknown): string | null {
  const block = part as AnyRecord | null;
  if (block?.type !== 'image' || block.source?.type !== 'base64' || typeof block.source.data !== 'string') {
    return null;
  }
  const mediaType = typeof block.source.media_type === 'string' ? block.source.media_type : 'image/png';
  return `data:${mediaType};base64,${block.source.data}`;
}

/**
 * Splits a tool result's `content` into what the transcript draws as text and as pictures.
 *
 * Only a block array that actually carries an image is rewritten: its images are lifted out and
 * the text blocks are joined, so the base64 never travels as a JSON string in `content`. Every
 * other shape is returned untouched — a text-only array is still stringified downstream and
 * unwrapped by the client tool views, which join agent results and MCP output with their own
 * separators, so flattening it here would change what those views show.
 *
 * Used by `claude-sessions.provider` for a live tool-result row and for the result it attaches to
 * a tool call when it reads history.
 */
export function liftToolResultImages(content: unknown): { content: unknown; images: InlineImage[] | undefined } {
  if (!Array.isArray(content)) {
    return { content, images: undefined };
  }

  const images: InlineImage[] = [];
  const textParts: string[] = [];
  for (const part of content as AnyRecord[]) {
    const dataUrl = readImageBlockDataUrl(part);
    if (dataUrl) {
      images.push({ data: dataUrl });
    } else if (part?.type === 'text' && typeof part.text === 'string') {
      textParts.push(part.text);
    }
  }

  if (images.length === 0) {
    return { content, images: undefined };
  }
  return { content: textParts.join('\n'), images };
}

/** File extension per media type for the pictures a tool can return; any other type stays inline. */
const ASSET_EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Moves every picture the tool results of a loaded history carry out of the messages and into the
 * global chat-assets folder, leaving `{ path }` in its place.
 *
 * A Read of a screenshot is hundreds of KB of base64, and `MAX_TOOL_RESULT_CONTENT` cannot cap it —
 * cutting a base64 image ruins it. Left inline, an image-heavy session's history page grew about
 * five-fold (measured on a 26-picture session: 2.0 MB to 9.9 MB) and the server's full-history cache
 * held every picture in memory. By reference the row is small again, and the chat draws the picture
 * through the route it already uses for path-based attachments (`useChatImageSrc`).
 *
 * The file is named for the hash of the picture's own base64, so the same picture is stored once
 * however many sessions or reloads name it, and an existing file is never rewritten or even decoded.
 * The `tr-` prefix keeps these apart from the composer's uploads in the same folder.
 *
 * A picture that cannot be stored (an unusual media type, a full disk) stays inline: the row still
 * draws, only larger.
 *
 * Used by `claude-sessions.provider` on a history load. A live `tool_result` frame stays inline —
 * it is one event, not a page of them.
 */
export async function storeToolResultImages(messages: NormalizedMessage[]): Promise<void> {
  const assetsDir = getGlobalImageAssetsDir();
  for (const message of messages) {
    const images = message.toolResult?.images;
    if (!images) {
      continue;
    }
    for (let index = 0; index < images.length; index += 1) {
      const storedPath = await storeDataUrlAsAsset(assetsDir, images[index].data);
      if (storedPath) {
        images[index] = { path: storedPath };
      }
    }
  }
}

/** Stores one data URL under `assetsDir` and returns its posix path, or null when it must stay inline. */
async function storeDataUrlAsAsset(assetsDir: string, dataUrl: string | undefined): Promise<string | null> {
  const match = dataUrl ? /^data:([^;,]+);base64,/.exec(dataUrl) : null;
  const extension = match ? ASSET_EXTENSION_BY_MEDIA_TYPE[match[1]] : undefined;
  if (!dataUrl || !match || !extension) {
    return null;
  }

  const base64 = dataUrl.slice(match[0].length);
  const filePath = path.join(assetsDir, `tr-${createHash('sha256').update(base64).digest('hex').slice(0, 32)}.${extension}`);
  try {
    await access(filePath);
    return toPosixPath(filePath);
  } catch {
    // Not stored yet: fall through and write it.
  }

  // Written beside the target and renamed into place, so a request that races the write never
  // reads half a picture, and two loads storing the same picture cannot corrupt each other.
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await mkdir(assetsDir, { recursive: true });
    await writeFile(temporaryPath, Buffer.from(base64, 'base64'));
    await rename(temporaryPath, filePath);
    return toPosixPath(filePath);
  } catch (error) {
    console.warn('[ClaudeProvider] Could not store a tool-result picture; serving it inline:', error instanceof Error ? error.message : error);
    await unlink(temporaryPath).catch(() => undefined);
    return null;
  }
}
