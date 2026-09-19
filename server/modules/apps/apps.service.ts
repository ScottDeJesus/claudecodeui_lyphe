import type { AppEntry, AppRegistryResponse, RegistryRow } from '@/shared/app-types.js';
import { AppError } from '@/shared/utils.js';

import { appIcons } from './apps.icons.js';
import { isDividerEntry, readEntries, writeEntries } from './apps.store.js';

/**
 * The application registry's APPLICATION verbs, and EVERY judgement about what a caller may send
 * as an app row. Dividers and moving rows are `apps.dividers.ts`.
 *
 * The routes are thin and the store knows only the file, so a rule lives here or nowhere: an id
 * that has to look like an id, a name that has to be a name, a url that has to be an address, a
 * duplicate that must not quietly overwrite the row it collides with. A POST that arrives through
 * some future caller skips the route it did not come through — it cannot skip this.
 *
 * Order is file order, always: no sorting, no favourites, no reorder verb. The file is the order,
 * and the operator sets it with a text editor.
 */
const APP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NAME_MAX_LENGTH = 64;
const DESCRIPTION_MAX_LENGTH = 160;

/** A description as stored: trimmed, and absent when blank — a blank one is no description. */
function optionalDescription(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    throw new AppError('A description must be text.', { code: 'APPS_DESCRIPTION_INVALID', statusCode: 400 });
  }
  const description = raw.trim();
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    throw new AppError(`A description may be at most ${DESCRIPTION_MAX_LENGTH} characters.`, {
      code: 'APPS_DESCRIPTION_TOO_LONG',
      statusCode: 400,
    });
  }
  return description.length > 0 ? description : undefined;
}

/** An id is minted from the name when the caller sends none; a name that mints nothing is a 400. */
function mintId(name: string, takenIds: Set<string>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_MAX_LENGTH);

  if (base.length === 0) {
    throw new AppError(`No id can be minted from the name "${name}".`, {
      code: 'APPS_ID_UNMINTABLE',
      statusCode: 400,
    });
  }

  // The suffix is why this is not a one-liner: a caller adding a second "Dispatch" gets
  // `dispatch-2` rather than a 409 he did not ask for. The name that collides is an ordinary
  // event — the file holds two builds of one app — while the ID must stay unique, so the id is
  // what yields. The base is re-trimmed to the ceiling once the suffix is on, so a 64-character
  // name cannot mint a 66-character id.
  let candidate = base;
  let suffix = 2;
  while (takenIds.has(candidate)) {
    candidate = `${base.slice(0, NAME_MAX_LENGTH - `-${suffix}`.length)}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function requireName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length === 0) {
    throw new AppError('An application needs a name.', {
      code: 'APPS_NAME_REQUIRED',
      statusCode: 400,
    });
  }
  if (name.length > NAME_MAX_LENGTH) {
    throw new AppError(`An application name may be at most ${NAME_MAX_LENGTH} characters.`, {
      code: 'APPS_NAME_TOO_LONG',
      statusCode: 400,
    });
  }
  return name;
}

/**
 * The url, checked as it will actually be opened rather than as it is stored.
 *
 * `{host}` is substituted with `localhost` before parsing, because that is the one address a
 * server can resolve on its own: `http://{host}:8004` is a valid address and `my-app` is not.
 * The stored row keeps `{host}` — the substitution exists to prove the shape, not to resolve it.
 */
function requireUrl(raw: unknown): string {
  const url = typeof raw === 'string' ? raw.trim() : '';
  if (url.length === 0) {
    throw new AppError('An application needs a url.', {
      code: 'APPS_URL_REQUIRED',
      statusCode: 400,
    });
  }

  const probe = url.replace(/\{host\}/gi, 'localhost');
  let parsed: URL;
  try {
    parsed = new URL(probe);
  } catch (error) {
    throw new AppError(`"${url}" is not an absolute url.`, {
      code: 'APPS_URL_INVALID',
      statusCode: 400,
      details: { cause: error instanceof Error ? error.message : String(error) },
    });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(`"${url}" is not an http or https url.`, {
      code: 'APPS_URL_INVALID',
      statusCode: 400,
    });
  }

  return url;
}

/** The two ports this app answers on, so the client can recognize its own row and never frame it. */
function selfPorts(): number[] {
  return [Number(process.env.SERVER_PORT || 3001), Number(process.env.VITE_PORT || 5173)];
}

export const appsService = {
  /**
   * What `GET /api/apps` answers: the registry in file order, this app's own two ports, and each
   * app's remembered tab icon (`apps.icons.ts`).
   */
  async listApps(): Promise<AppRegistryResponse> {
    const entries = readEntries();
    const apps = entries.filter((entry): entry is AppEntry => !isDividerEntry(entry));
    const rows: RegistryRow[] = entries.map((entry) => (isDividerEntry(entry)
      ? { kind: 'divider', id: entry.id, title: entry.divider }
      : { kind: 'app', id: entry.id }));
    return { apps, rows, selfPorts: selfPorts(), icons: await appIcons(apps) };
  },

  /**
   * Appends one row and answers it. The ids already in the file are what an explicit id is
   * checked against and what a minted one steps around; a collision with the operator's own row
   * is a 409, never an overwrite.
   */
  addApp(input: { id?: string; name: string; url: string; description?: string }): AppEntry {
    const name = requireName(input?.name);
    const url = requireUrl(input?.url);
    const description = optionalDescription(input?.description);

    // Dividers share the id space: a move or a removal names a row by id, whichever kind it is.
    const entries = readEntries();
    const takenIds = new Set(entries.map((entry) => entry.id));

    let id: string;
    if (input?.id === undefined || input.id === null || input.id === '') {
      id = mintId(name, takenIds);
    } else {
      id = String(input.id).trim();
      if (!APP_ID_PATTERN.test(id)) {
        throw new AppError(
          `"${id}" is not an application id: lowercase letters, digits and dashes, starting with a letter or a digit.`,
          { code: 'APPS_ID_INVALID', statusCode: 400 },
        );
      }
      if (takenIds.has(id)) {
        throw new AppError(`An application with id "${id}" already exists.`, {
          code: 'APPS_DUPLICATE_ID',
          statusCode: 409,
        });
      }
    }

    const app: AppEntry = description ? { id, name, url, description } : { id, name, url };
    writeEntries([...entries, app]);
    return app;
  },

  /**
   * Sets or clears one row's description, leaving its place in the file and every other field as
   * they were. A blank description removes the field, and the row shows its address again.
   */
  updateDescription(id: string, raw: unknown): AppEntry {
    const description = optionalDescription(raw);
    const entries = readEntries();
    const index = entries.findIndex((entry) => entry.id === id && !isDividerEntry(entry));
    if (index === -1) {
      throw new AppError(`No application with id "${id}".`, { code: 'APPS_APP_NOT_FOUND', statusCode: 404 });
    }
    const { description: _previous, ...rest } = entries[index] as AppEntry;
    const next: AppEntry = description ? { ...rest, description } : rest;
    writeEntries(entries.map((entry, at) => (at === index ? next : entry)));
    return next;
  },

  /** Removes one row. An id that names nothing is a 404 rather than a silent success. */
  removeApp(id: string): void {
    const entries = readEntries();
    const remaining = entries.filter((entry) => entry.id !== id || isDividerEntry(entry));

    if (remaining.length === entries.length) {
      throw new AppError(`No application with id "${id}".`, {
        code: 'APPS_APP_NOT_FOUND',
        statusCode: 404,
      });
    }

    writeEntries(remaining);
  },
};
