import { statSync } from 'node:fs';
import path from 'node:path';

import { sessionPanelDb, type SessionPanelHeadRow, type SessionPanelRow } from '@/modules/database/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type {
  SessionPanelChangedEvent,
  SessionPanelInput,
  SessionPanelKind,
  SessionPanelVersion,
  SessionPanelVersionHead,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * The session panel's verbs: the one place beside the talk that a chat has to itself. A chat SHOWS a thing there, UPDATES it in
 * place as a new version, and CLEARS it, with its own `panel` command; the person reads it in the chat's panel and walks back
 * along its versions.
 *
 * ONE THING AT A TIME, EVERY SHOW A VERSION. The panel shows the chat's newest version. A show and an update each add one; an
 * update is a show that keeps the kind and the title of what is showing unless it names its own, and is refused on an empty
 * panel, so a chat that meant to change a thing never starts a second one by accident. The line is kept to its newest
 * `KEEP_VERSIONS`.
 *
 * WHERE THE JUDGING LIVES. The routes decide transport shape. Everything here decides whether the content is USABLE: a title is
 * one plain line, a page is an absolute http(s) address, a picture is an address or an image file that is on this box now, a
 * diagram and a widget are text within their ceilings. A thing is REFUSED, never repaired, in a sentence the chat reads.
 *
 * A PICTURE KEPT AS A FILE IS READ WHERE IT LIES. The row stores the file's absolute path, and the reader's door streams the file
 * when the panel draws it, so the picture is the file as it is then. A file that has since gone is said to be gone.
 *
 * THE FRAME NAMES THE CHAT. Every write that changed a row sends one `session_panel_changed` to every open socket, carrying the
 * chat's app session id; a panel of another chat ignores it. Nothing else rides the frame.
 *
 * Consumers: `session-panel.routes.ts` (the reader's door) and `session-panel.command-routes.ts` (the `panel` command's), handed
 * this object, so the two doors refuse alike and both send the frame.
 */

/** How many versions a chat's line keeps: the newest of them is what shows, the rest are the way back. */
const KEEP_VERSIONS = 30;

/** A title's ceiling, in characters after trimming. */
const TITLE_MAX = 80;

/** The ceilings of the two kinds that carry text, in characters: a diagram's mermaid source and a widget's HTML body. */
const DIAGRAM_MAX = 20_000;
const WIDGET_MAX = 300_000;

/** The longest address a page or a picture may name: the embed frame's own ceiling (`classifyWidgetBody.ts`). */
const ADDRESS_MAX = 2048;

/** The largest picture file the panel will draw, in bytes. */
const PICTURE_FILE_MAX = 20 * 1024 * 1024;

/** The picture files the panel draws, by extension, with the type each is served as. */
const PICTURE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

/** Control characters and every way a line can break: not part of one plain line. */
const NOT_ONE_LINE = /[\p{Cc}\u0085\u2028\u2029]/u;

/** A refused thing: 422 with the sentence that says why, so the chat can send it again put right. */
function refused(sentence: string): AppError {
  return new AppError(sentence, { code: 'SESSION_PANEL_REFUSED', statusCode: 422 });
}

/** The title as stored, or the 422 that says which rule it broke. */
function judgeTitle(raw: string): string {
  const title = raw.trim();
  if (title === '') throw refused('A title cannot be empty.');
  if (NOT_ONE_LINE.test(title)) throw refused('A title must be one plain line.');
  if (title.length > TITLE_MAX) throw refused(`A title can be ${TITLE_MAX} characters at most; this one is ${title.length}.`);
  return title;
}

/** Whether a string is an absolute http: or https: address, asked by parsing and never by its prefix. */
function isWebAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** The address as stored, or the 422: absolute, http or https, within the ceiling. `what` names the kind in the sentence. */
function judgeAddress(raw: string, what: string): string {
  const address = raw.trim();
  if (!isWebAddress(address)) throw refused(`${what} must be an absolute http:// or https:// address.`);
  if (address.length > ADDRESS_MAX) throw refused(`${what} can be ${ADDRESS_MAX} characters at most; this one is ${address.length}.`);
  return address;
}

/** A picture's file as it lies now: its type and size, or null when it is not a picture file the panel draws. */
function pictureFileAt(filePath: string): { contentType: string; size: number } | null {
  const contentType = PICTURE_TYPES[path.extname(filePath).toLowerCase()];
  if (contentType === undefined || !path.isAbsolute(filePath)) return null;
  try {
    const stat = statSync(filePath);
    return stat.isFile() ? { contentType, size: stat.size } : null;
  } catch {
    return null;
  }
}

/** A picture's body as stored, or the 422: an http(s) address, or the absolute path of an image file that is on this box now. */
function judgePicture(raw: string): string {
  const body = raw.trim();
  if (/^https?:\/\//i.test(body)) return judgeAddress(body, 'A picture\'s address');
  if (!path.isAbsolute(body)) throw refused('A picture is an http(s) address or the absolute path of an image file on this machine.');
  if (PICTURE_TYPES[path.extname(body).toLowerCase()] === undefined) {
    throw refused(`A picture file must be one of ${Object.keys(PICTURE_TYPES).join(', ')}.`);
  }
  const file = pictureFileAt(body);
  if (file === null) throw refused(`There is no picture file at ${body}.`);
  if (file.size > PICTURE_FILE_MAX) throw refused(`A picture file can be ${PICTURE_FILE_MAX / (1024 * 1024)} MB at most.`);
  return body;
}

/** A text body (a diagram's source, a widget's HTML) as stored, or the 422. It is kept as written, less the blank space round it. */
function judgeText(raw: string, what: string, max: number): string {
  const body = raw.trim();
  if (body === '') throw refused(`${what} cannot be empty.`);
  if (body.length > max) throw refused(`${what} can be ${max} characters at most; this one is ${body.length}.`);
  return body;
}

/** The body as stored for its kind, or the refusal. */
function judgeBody(kind: SessionPanelKind, raw: string): string {
  if (kind === 'page') return judgeAddress(raw, 'A page\'s address');
  if (kind === 'picture') return judgePicture(raw);
  if (kind === 'diagram') return judgeText(raw, 'A diagram', DIAGRAM_MAX);
  return judgeText(raw, 'A widget', WIDGET_MAX);
}

/** One row's head as the wire carries it. */
function toHead(row: SessionPanelHeadRow): SessionPanelVersionHead {
  return { id: row.id, version: row.version, kind: row.kind, title: row.title, createdAt: row.created_at };
}

/** One row whole as the wire carries it. A picture kept as a file is marked, and its path stays the body: the reader's page shows it as the picture's name and never loads it. */
function toVersion(row: SessionPanelRow): SessionPanelVersion {
  return { ...toHead(row), body: row.body, pictureIsFile: row.kind === 'picture' && !/^https?:\/\//i.test(row.body) };
}

/** The reader's refusal for a version that is gone (cleared, trimmed, its chat deleted) or is another account's. */
function versionGone(): AppError {
  return new AppError('That version is no longer on the panel.', { code: 'SESSION_PANEL_NOT_FOUND', statusCode: 404 });
}

/** Puts one `session_panel_changed` frame on every open gateway socket, after a write landed. The fan-out is the followups lane's: stringify once, skip a socket that is not open, catch per client. */
function broadcastPanelChanged(appSessionId: string): void {
  const message = JSON.stringify({ kind: 'session_panel_changed', appSessionId, at: Date.now() } satisfies SessionPanelChangedEvent);

  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) return;
    try {
      client.send(message);
    } catch (error) {
      console.error(
        `[SessionPanel] could not send a session_panel_changed frame to a client: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

/** The session panel's verbs, as one instance. Both route files are handed this and call it verbatim. */
export const sessionPanelService = {
  /** The chat's command puts a thing on its panel: a kind, a title and a body, all required. Answers the version as stored, with how many the line now holds. */
  show(appSessionId: string, userId: number, input: SessionPanelInput): { shown: SessionPanelVersionHead; versions: number } {
    if (input.kind === null) throw refused('Say what to show: --diagram, --picture, --page or --widget.');
    if (input.title === null) throw refused('A thing shown on the panel needs a --title.');
    const row = sessionPanelDb.addVersion({
      sessionId: appSessionId,
      userId,
      kind: input.kind,
      title: judgeTitle(input.title),
      body: judgeBody(input.kind, input.body),
      keep: KEEP_VERSIONS,
    });
    broadcastPanelChanged(appSessionId);
    return { shown: toHead(row), versions: sessionPanelDb.listHeadsForChat(appSessionId).length };
  },

  /** The chat's command changes what is showing, as a new version: the kind and the title showing are kept unless it names its own. Refused on an empty panel. */
  update(appSessionId: string, userId: number, input: SessionPanelInput): { shown: SessionPanelVersionHead; versions: number } {
    const showing = sessionPanelDb.latestForChat(appSessionId);
    if (showing === undefined) {
      throw new AppError('Nothing is on the panel to update. Put a thing there first with "panel show".', {
        code: 'SESSION_PANEL_EMPTY',
        statusCode: 409,
      });
    }
    return sessionPanelService.show(appSessionId, userId, { kind: input.kind ?? showing.kind, title: input.title ?? showing.title, body: input.body });
  },

  /** The chat's command empties its panel. Answers how many versions went; clearing an empty panel is done already. */
  clear(appSessionId: string): { cleared: number } {
    const cleared = sessionPanelDb.clearForChat(appSessionId);
    if (cleared > 0) broadcastPanelChanged(appSessionId);
    return { cleared };
  },

  /** The chat's command asks what its panel shows: the newest version's head, or null, with how many the line holds. */
  status(appSessionId: string): { showing: SessionPanelVersionHead | null; versions: number } {
    const heads = sessionPanelDb.listHeadsForChat(appSessionId);
    return { showing: heads.length === 0 ? null : toHead(heads[heads.length - 1]), versions: heads.length };
  },

  /** The reader's list: the versions of one chat that the account owns, without their bodies, oldest first. A chat of another account answers an empty list, as a chat with an empty panel does. */
  listForUser(userId: number, appSessionId: string): SessionPanelVersionHead[] {
    return sessionPanelDb.listHeadsForChatOfUser(appSessionId, userId).map(toHead);
  },

  /** The reader's one version, whole. */
  getForUser(userId: number, id: number): SessionPanelVersion {
    const row = sessionPanelDb.getForUser(id, userId);
    if (row === undefined) throw versionGone();
    return toVersion(row);
  },

  /** The file of a version's picture, for the reader's door to stream: its path, type and size as it lies now. 404 for a version that is gone or holds no picture file, and for a file that has since gone. */
  pictureFileForUser(userId: number, id: number): { path: string; contentType: string; size: number } {
    const row = sessionPanelDb.getForUser(id, userId);
    if (row === undefined) throw versionGone();
    const file = row.kind === 'picture' ? pictureFileAt(row.body) : null;
    if (file === null || file.size > PICTURE_FILE_MAX) {
      throw new AppError('That picture is no longer where the chat showed it from.', { code: 'SESSION_PANEL_PICTURE_GONE', statusCode: 404 });
    }
    return { path: row.body, ...file };
  },
};

export type SessionPanelService = typeof sessionPanelService;
