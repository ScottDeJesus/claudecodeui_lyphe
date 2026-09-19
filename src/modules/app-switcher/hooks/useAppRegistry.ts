import { useCallback, useEffect, useRef, useState } from 'react';

import { refusalInWords } from '@/modules/app-switcher/utils/registryRequests';
import type { AppEntry, AppRegistryResponse, RegistryRow } from '@/shared/app-types';
import { api } from '@/shared/api';

/**
 * The application registry, as the drawer reads it.
 *
 * NO POLLING AND NO WEBSOCKET. The registry is a file on the server that changes when the operator
 * or a builder edits it, which is a rare, deliberate act with nobody watching for it to land — a
 * timer here would spend the whole app's life asking a question whose answer has not moved, and a
 * subscription would put a socket on every page that never mounts a pane. The drawer calls
 * `refresh()` on every open instead, so the reading is at most one drawer-open old, and a row
 * appended a second ago is there the next time the drawer is looked at.
 *
 * A FAILED READ KEEPS THE LAST GOOD LIST AND RAISES AN ERROR BESIDE IT. That pairing is the point:
 * clearing `apps` on a failure would show the reader an empty registry — "there are no
 * applications" — when the honest sentence is "the registry could not be read", and the drawer
 * already has a Banner for the second one. The stale list stays so an open pane keeps its name.
 */
export function useAppRegistry(): {
  apps: AppEntry[];
  /** The drawer's list in file order, dividers included. */
  rows: RegistryRow[];
  selfPorts: number[];
  /** Each app's own tab icon as a data URL, by app id; an app that publishes none is absent. */
  icons: Record<string, string>;
  /** Why the registry could not be read — the server's own message when it sent one, this file's
   *  own sentence when it answered with something that is not a registry. Null once a read lands. */
  error: string | null;
  /**
   * Whether the FIRST read has answered — with rows, or with a refusal, which is the point: until
   * it has, an empty `apps` is unmeasured rather than empty.
   *
   * The distinction is not academic. The read lands 30-60ms after the FAB appears on a warm server
   * (measured by CDP, 2026-09-16) and later on a cold one or a phone on Tailscale, and a drawer that
   * read the empty BEFORE state as an empty registry would put "No applications yet" in front of a
   * reader who has seven — an invitation to add a duplicate of a row that is arriving.
   *
   * It is set by every read and cleared by none: a later refresh re-reads a list that is already on
   * screen, and blanking it back into placeholders would be the drawer flickering the rows the
   * reader is looking at.
   */
  registryRead: boolean;
  /** Re-reads the registry. Called on every drawer open, and safe to call at any other time. */
  refresh: () => Promise<void>;
} {
  const [registry, setRegistry] = useState<AppRegistryResponse>({ apps: [], rows: [], selfPorts: [], icons: {} });
  const [error, setError] = useState<string | null>(null);
  const [registryRead, setRegistryRead] = useState(false);
  // Mount flag: a read that resolves after the drawer's tree is gone must not set state.
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await readRegistry(await api.apps.list());
      if (!mountedRef.current) return;
      setRegistry(next);
      setError(null);
    } catch (failure) {
      if (!mountedRef.current) return;
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      // After the FIRST settled read, success or refusal alike — see `registryRead` above.
      if (mountedRef.current) setRegistryRead(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  return { apps: registry.apps, rows: registry.rows, selfPorts: registry.selfPorts, icons: registry.icons, error, registryRead, refresh };
}

/**
 * A 200's body, or the server's message as a thrown error.
 *
 * `readApiJson` is deliberately NOT used here: what it would throw for this server's envelope is in
 * `refusalInWords` (`utils/registryRequests.ts`), which reads the message out of the envelope for
 * this call and for the registry's two writes alike.
 *
 * A 200 that is not a registry — unparseable, or parsed and not this shape — is the SAME sentence
 * in both cases, and it is this file's own rather than the runtime's. `app.get('*')`
 * (`server/index.ts`) answers `/api/apps` with `index.html` at status 200 in any process where the
 * apps route is not mounted, so this path is reachable in ordinary use, and a raw
 * `JSON.parse` failure handed to the drawer would put `Unexpected token '<', "<!DOCTYPE "…` in the
 * Banner — a stack-trace fragment where the key list already carries `applications.unreadable`.
 * `apps` and `selfPorts` are both read by the drawer, so a missing array would otherwise surface
 * as a crash inside a render rather than as a Banner beside a stale list.
 */
async function readRegistry(response: Response): Promise<AppRegistryResponse> {
  if (!response.ok) {
    throw new Error(await refusalInWords(response, 'The application registry could not be read'));
  }

  const body = (await response.json().catch(() => null)) as Partial<AppRegistryResponse> | null;
  if (body === null || !Array.isArray(body.apps) || !Array.isArray(body.selfPorts)) {
    throw new Error('The application registry answered in a shape this app cannot read.');
  }
  // `icons` is optional on read: a server from before icons answers without it, and has none to show.
  const icons = typeof body.icons === 'object' && body.icons !== null ? body.icons : {};
  // `rows` likewise: without it the list is the apps alone, in their order.
  const rows: RegistryRow[] = Array.isArray(body.rows) ? body.rows : body.apps.map((app) => ({ kind: 'app', id: app.id }));
  return { apps: body.apps, rows, selfPorts: body.selfPorts, icons };
}
