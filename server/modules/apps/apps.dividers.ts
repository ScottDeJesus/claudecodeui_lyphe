import { randomBytes } from 'node:crypto';

import type { AppEntry, DividerEntry } from '@/shared/app-types.js';
import { AppError } from '@/shared/utils.js';

import { isDividerEntry, readEntries, writeEntries } from './apps.store.js';

/**
 * The drawer list's LAYOUT verbs: dividers — a line across the list with a title the operator can
 * edit, blank for a plain break — and moving any row, app or divider, one place up or down.
 *
 * A divider is a row of the registry file like an app is (`{ "id", "divider": "<title>" }`), so its
 * place IS its position in the file and a move is a swap with the neighbour. Kept apart from
 * `apps.service.ts`, which holds what an APPLICATION row may be; this file holds where rows sit.
 */
const TITLE_MAX_LENGTH = 64;

function requireTitle(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    throw new AppError('A divider title must be text.', { code: 'APPS_DIVIDER_TITLE_INVALID', statusCode: 400 });
  }
  const title = raw.trim();
  if (title.length > TITLE_MAX_LENGTH) {
    throw new AppError(`A divider title may be at most ${TITLE_MAX_LENGTH} characters.`, {
      code: 'APPS_DIVIDER_TITLE_TOO_LONG',
      statusCode: 400,
    });
  }
  return title;
}

function dividerIndex(entries: Array<AppEntry | DividerEntry>, id: string): number {
  const index = entries.findIndex((entry) => entry.id === id && isDividerEntry(entry));
  if (index === -1) {
    throw new AppError(`No divider with id "${id}".`, { code: 'APPS_DIVIDER_NOT_FOUND', statusCode: 404 });
  }
  return index;
}

export const dividersService = {
  /** Appends a divider at the end of the list and answers it; the drawer moves it into place. */
  addDivider(rawTitle: unknown): DividerEntry {
    const title = requireTitle(rawTitle);
    const entries = readEntries();
    const taken = new Set(entries.map((entry) => entry.id));
    let id: string;
    do {
      id = `divider-${randomBytes(3).toString('hex')}`;
    } while (taken.has(id));
    const divider: DividerEntry = { id, divider: title };
    writeEntries([...entries, divider]);
    return divider;
  },

  /** Sets a divider's title; a blank one leaves a plain line. */
  renameDivider(id: string, rawTitle: unknown): DividerEntry {
    const title = requireTitle(rawTitle);
    const entries = readEntries();
    const index = dividerIndex(entries, id);
    const divider: DividerEntry = { id, divider: title };
    writeEntries(entries.map((entry, at) => (at === index ? divider : entry)));
    return divider;
  },

  removeDivider(id: string): void {
    const entries = readEntries();
    const index = dividerIndex(entries, id);
    writeEntries(entries.filter((_, at) => at !== index));
  },

  /**
   * Moves one row — app or divider — a place up or down by swapping it with its neighbour. A row
   * already at that end stays where it is, and the call still succeeds: there is nowhere further.
   */
  moveRow(id: string, direction: unknown): void {
    if (direction !== 'up' && direction !== 'down') {
      throw new AppError('A move is "up" or "down".', { code: 'APPS_MOVE_INVALID', statusCode: 400 });
    }
    const entries = readEntries();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      throw new AppError(`No row with id "${id}".`, { code: 'APPS_ROW_NOT_FOUND', statusCode: 404 });
    }
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= entries.length) return;
    const next = [...entries];
    [next[index], next[target]] = [next[target], next[index]];
    writeEntries(next);
  },
};
