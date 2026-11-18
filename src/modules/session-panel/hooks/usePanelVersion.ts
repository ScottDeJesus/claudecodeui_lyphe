import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { SessionPanelVersion } from '@/shared/types';

/**
 * Every version read whole so far, by id. A version never changes once it is shown (a change is a new version with a new id), so
 * one read of it is good for as long as the page lives, and walking back and forth along the line asks the server once for each.
 */
const read = new Map<number, SessionPanelVersion>();

/** What a version's read has come to: the version, `null` while it is being read (or when the read failed, to be asked again), or `'gone'` when the server no longer has it. */
type Held = SessionPanelVersion | null | 'gone';

/**
 * The reads that are out, by id, each already parsed. One read serves everyone who asks while it is out: the api hands two askers
 * of one address the same response, and a response's body can be read once.
 */
const reading = new Map<number, Promise<Held>>();

/** Reads one version whole, once: a second ask while the first is out waits on the same answer. */
function readVersion(id: number): Promise<Held> {
  const out = reading.get(id);
  if (out !== undefined) return out;
  const asked = (async (): Promise<Held> => {
    try {
      const response = await api.sessionPanel.version(id);
      if (response.status === 404) return 'gone';
      if (!response.ok) return null;
      const body = (await response.json()) as { data?: SessionPanelVersion };
      if (!body.data || typeof body.data.body !== 'string') return null;
      read.set(id, body.data);
      return body.data;
    } catch {
      return null;
    } finally {
      reading.delete(id);
    }
  })();
  reading.set(id, asked);
  return asked;
}

/**
 * One version of the panel, whole: its body beside its head. Null while it is read, `'gone'` when it is no longer there (cleared
 * or trimmed between the list and this read).
 *
 * Used by `SessionPanel`, for the version it draws.
 */
export function usePanelVersion(id: number | null): Held {
  // What the read for the id now asked for came to, tagged with that id so an answer for one version never draws as another.
  const [held, setHeld] = useState<{ id: number; value: Held } | null>(null);

  useEffect(() => {
    if (id === null || read.has(id)) return undefined;
    let current = true;
    void readVersion(id).then((value) => {
      if (current) setHeld({ id, value });
    });
    return () => {
      current = false;
    };
  }, [id]);

  if (id === null) return null;
  return read.get(id) ?? (held !== null && held.id === id ? held.value : null);
}
