import { useCallback, useEffect, useRef, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { AgentLaunchCensus, AgentLaunchDefaultsChange, AgentLaunchRowChange } from '@/shared/agent-launch-types';

/** What `saving` holds while the Defaults block, and not a row, is being written — the panel's own word for it, spelled the same. */
const DEFAULTS_SAVING = '@defaults';

/** The sentence a failed call carries: the server's own `{ error }` where it sent one, else what `fetch` said. */
function sentenceOf(failure: unknown): string {
  return failure instanceof Error && failure.message ? failure.message : String(failure);
}

/** A plain JSON object, as opposed to an array, a scalar or nothing at all. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a body carries every part of the census the panel dereferences. A census is not checked field
 * for field — the Python side owns its shape — only enough that a body which is not one (a refusal an
 * envelope let through with a 200, an empty object) cannot reach the panel and blank the tab.
 */
function isCensus(body: unknown): body is AgentLaunchCensus {
  if (!isRecord(body)) return false;
  const { choices, defaults } = body;
  return (
    typeof body.state === 'string' &&
    Array.isArray(body.problems) &&
    Array.isArray(body.rows) &&
    isRecord(choices) &&
    Array.isArray(choices.models) &&
    Array.isArray(choices.efforts) &&
    isRecord(defaults) &&
    isRecord(defaults.effort)
  );
}

/**
 * What a route answered, as a census — or the sentence for why it is not one.
 *
 * The server's own `{ error }` sentence comes through `readApiJson` untouched. A body that is not JSON
 * at all — an edge's 502 page, or the app's own `index.html` that a path this process does not mount
 * falls through to with a 200 — is never shown as the parser's fragment: it says the launch table's API
 * did not answer, and with what status.
 */
async function readCensus(response: Response): Promise<AgentLaunchCensus> {
  const unexpected = new Error(`The launch table's API did not answer with a census (HTTP ${response.status}).`);
  let body: unknown;
  try {
    body = await readApiJson<unknown>(response);
  } catch (failure) {
    throw failure instanceof SyntaxError ? unexpected : failure;
  }
  if (!isCensus(body)) throw unexpected;
  return body;
}

/**
 * Used by the Agents panel (`AgentLaunchPanel`) for everything it draws and every press it takes.
 *
 * `saving` is the name of the row being saved, or `'@defaults'` while the Defaults block saves — the
 * newest write still in flight, so a save that finishes never releases the hold of one that has not;
 * `error` is the server's own sentence and never a paraphrase of it. A failed call keeps the census
 * that was already held, and the next call that succeeds clears the sentence.
 *
 * EVERY WRITE ANSWERS WITH THE CENSUS READ BACK AFTER IT, so a save replaces the held picture with the
 * one the table confirmed rather than patching the old one. A READ that a newer call overtook is
 * dropped: a reload that started before a save and lands after it would otherwise put back the
 * picture the save just replaced. Writes are never dropped — the server serialises them.
 */
export function useAgentLaunch(): {
  census: AgentLaunchCensus | null;
  error: string | null;
  saving: string | null;
  refresh(): void;
  saveRow(name: string, change: AgentLaunchRowChange): Promise<void>;
  saveDefaults(change: AgentLaunchDefaultsChange): Promise<void>;
} {
  // The census the last successful call answered with; null until the first read lands.
  const [census, setCensus] = useState<AgentLaunchCensus | null>(null);
  // The server's own sentence for the last failed call; null once a call succeeds.
  const [error, setError] = useState<string | null>(null);
  // Every write still in flight by row name (or DEFAULTS_SAVING), oldest first: a press on a second row is normal, so a hold ends per write.
  const [inFlight, setInFlight] = useState<string[]>([]);
  // Bumped at the start and end of every write and the start of every read; a read lands only if it is still the newest.
  const epoch = useRef(0);

  const refresh = useCallback(() => {
    const mine = ++epoch.current;
    api.agentLaunch
      .census()
      .then(readCensus)
      .then(
        (answer) => {
          if (mine !== epoch.current) return;
          setCensus(answer);
          setError(null);
        },
        (failure: unknown) => {
          if (mine !== epoch.current) return;
          setError(sentenceOf(failure));
        },
      );
  }, []);

  const write = useCallback(async (held: string, send: () => Promise<Response>) => {
    ++epoch.current;
    setInFlight((names) => [...names, held]);
    try {
      setCensus(await readCensus(await send()));
      setError(null);
    } catch (failure) {
      setError(sentenceOf(failure));
    } finally {
      ++epoch.current;
      // Release only THIS write's hold: the same name pressed twice holds twice, and the first answer frees one.
      setInFlight((names) => {
        const mine = names.indexOf(held);
        return mine < 0 ? names : names.filter((_, at) => at !== mine);
      });
    }
  }, []);

  // The panel opens on a read: the same call the reload button makes.
  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveRow = useCallback(
    (name: string, change: AgentLaunchRowChange) => write(name, () => api.agentLaunch.saveRow(name, change)),
    [write],
  );
  const saveDefaults = useCallback(
    (change: AgentLaunchDefaultsChange) => write(DEFAULTS_SAVING, () => api.agentLaunch.saveDefaults(change)),
    [write],
  );

  return { census, error, saving: inFlight.at(-1) ?? null, refresh, saveRow, saveDefaults };
}
