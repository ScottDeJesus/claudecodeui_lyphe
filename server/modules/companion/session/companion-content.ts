import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import type { CompanionAttachment } from '@/shared/companion-types.js';
import { claudeImageBlocks, type ClaudeImageBlock } from '@/shared/image-attachments.js';

import type { UnansweredMessage } from '../companion-unanswered.js';

/**
 * What a message to her CLI is made of, apart from the words: the pictures that ride with it, and the hold the boot replay puts on new
 * pushes while it reads them.
 *
 * A PICTURE reaches her as it reaches a Claude chat: when pictures ride, the message's content is the assembled text, then one image block
 * per picture, in their order; with none it stays a plain string, as it always was. The blocks are read by the chat's own reader
 * (`claudeImageBlocks`, `server/shared/image-attachments.ts`) and kept in memory beside the message (`Sent.images`): the ledger writes
 * his words to disk and never a byte of a picture, so a restart reads the pictures again from the upload store.
 *
 * THE REPLAY HOLD. The boot replay says his unanswered words to her again, and a line with a picture must have its picture read first
 * (async). While it reads, a push that arrives is parked and goes after the replay's own messages, so his words keep their order. The
 * hold ends when the reads settle: the replay releases it, an event, never a timer, and nothing here polls.
 *
 * Consumers: `companion-session.ts` (all three).
 */

/** The SDK's image block types `media_type` as the four Claude image types; `claudeImageBlocks` emits no other (its `CLAUDE_IMAGE_MEDIA_TYPES` gate). */
type SdkContent = SDKUserMessage['message']['content'];
type SdkImageBlock = Extract<Exclude<SdkContent, string>[number], { type: 'image' }>;

/**
 * A message's content: the assembled text alone (a string, as today) when no picture rides, else the text block then one image block per
 * picture, in order. Consumed by `companion-session.ts`, for each message it pushes and each it says again.
 */
export function messageContent(text: string, images: readonly ClaudeImageBlock[]): SdkContent {
  if (images.length === 0) return text;
  // `ClaudeImageBlock` types `media_type` as any string because the chat reads pictures through the same reader; the reader's gate is the four types.
  return [{ type: 'text', text }, ...(images as readonly SdkImageBlock[])];
}

/** What `createReplayHold` answers: one hold, made when a replay begins and released once. */
type ReplayHold = {
  /** True from the hold's making until `release`: a push that arrives meanwhile is parked. */
  holding(): boolean;
  /** Keeps `push` to run at `release`, after every push parked before it. It must not throw: the caller guards it, so one push that fails cannot lose those behind it. */
  park(push: () => void): void;
  /** The reads have settled: the hold ends, then what was parked runs, in the order it came. A second call does nothing. */
  release(): void;
};

/** Holds pushes while the boot replay reads its pictures, then lets them through in the order they came. Consumed by `companion-session.ts`'s `resendUnanswered`. */
export function createReplayHold(): ReplayHold {
  let holding = true;
  let parked: Array<() => void> = [];
  return {
    holding: () => holding,
    park(push) {
      parked.push(push);
    },
    release() {
      holding = false;
      const waiting = parked;
      parked = [];
      for (const push of waiting) push();
    },
  };
}

/**
 * The pictures of one entry's files, each read on its own by the chat's own reader from the upload store, so the one it cannot read (skipped, with the reader's
 * warning) is known: the message goes without it, and its record is set `unopened` in the files told to her. Her `restate`s and the next boot read those records, so they never announce it either.
 * Consumed by `companion-session.ts`'s `resendUnanswered`, for the account `userId` (named in the journal line of a read that failed whole).
 */
export async function readPictures(userId: number, entry: UnansweredMessage): Promise<{ images: ClaudeImageBlock[]; attachments: UnansweredMessage['attachments'] }> {
  const files = entry.attachments ?? [];
  let read: ClaudeImageBlock[][];
  try {
    read = await Promise.all(files.map((file) => (file.opens === 'shown' ? claudeImageBlocks([file]) : [])));
  } catch (error) {
    console.error(`[Companion] account ${userId}: the pictures of a message her last process never answered could not be read; it is sent without them`, error);
    read = files.map(() => []);
  }
  const attachments = files.map((file, index): CompanionAttachment => (file.opens === 'shown' && read[index].length === 0 ? { ...file, opens: 'unopened' } : file));
  return { images: read.flat(), attachments: entry.attachments === undefined ? undefined : attachments };
}
