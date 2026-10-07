import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { CerberusChangedEvent, CerberusRunLine, CerberusRunOutputEvent } from '@/shared/cerberus-types.js';

/**
 * The two frames Cerberus puts on the browser's gateway socket: the hint `cerberus_changed`, and a
 * running fix's lines, `cerberus_run_output`.
 *
 * A hint, not a picture — it names what moved and the screen reads again — so it can be coalesced
 * without losing anything. The first `hintChanged` of a quiet spell opens a one-second window;
 * everything named while it is open is merged, and ONE frame goes out when it closes. A warden
 * reporting thirty components in a burst, a definition write that touches a dozen checks and a link
 * flapping all cost the browser a single re-read each second, never one per cause.
 *
 * The fan-out copies `notes.service.ts`'s `broadcastNotesChanged`: `JSON.stringify` once for the
 * whole set, a walk of `connectedClients` skipping any socket that is not open, and a catch PER
 * CLIENT, because a dead socket must not cost every client after it its frame.
 *
 * Callers hint AFTER their write committed; a write that refused never told a screen it happened.
 * What is never hinted: a result that was not stored — nothing on screen could have changed.
 *
 * `cerberus_run_output` is a PICTURE, not a hint, and is never coalesced: the lines of a running fix
 * must appear as they arrive, and a re-read cannot give a line the screen was never told of. It goes
 * out at once, one frame per stored batch, through the same fan-out.
 *
 * Consumers: `definitions.service.ts` (a definition, label or retire write), `ingest.service.ts`
 * (a stored change), `warden-gateway.ts` (link changes, through `wardenLinks.onChange`),
 * `warden-link.ts` (a node's first heartbeat), `mutes.service.ts` (a mute set or lifted),
 * `catalog.service.ts` and `run-frames.ts` (an entry or a run moving; `sendRunOutput` for a stored
 * batch of lines) and, through the cerberus barrel, the projects module's `project-node.service.ts`
 * (a project moved to or from a node).
 */

/** How long a window stays open after its first hint, collecting the rest. */
const COALESCE_WINDOW_MS = 1000;

type OpenWindow = { nodes: Set<string>; checks: Set<string> };

let openWindow: OpenWindow | null = null;

/** Puts one event on every open browser socket; a socket that throws costs only itself its frame. */
function sendToBrowsers(event: CerberusChangedEvent | CerberusRunOutputEvent): void {
  const message = JSON.stringify(event);

  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) return;

    try {
      client.send(message);
    } catch (error) {
      console.error(
        `[Cerberus] could not send a ${event.kind} frame to a client: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}

function closeWindow(): void {
  const closing = openWindow;
  openWindow = null;
  if (!closing) return;

  sendToBrowsers({
    kind: 'cerberus_changed',
    at: Date.now(),
    nodes: [...closing.nodes],
    checks: [...closing.checks],
  });
}

/**
 * Says that something Cerberus shows has changed. `nodes` are node ids; each entry of `checks` is
 * `<node>/<key>` (`eis1/docstore/backup.age`) — a node never holds a `/`, so the FIRST one splits
 * the two. The frame goes out when the one-second window this call opened or joined closes.
 *
 * The window's timer is unref'd: a process asked to exit does not wait a second to say a screen
 * should re-read, and a screen of a process that is exiting has no use for it.
 *
 * Consumers: the Cerberus services listed in this file's header.
 */
export function hintChanged(change: { nodes?: string[]; checks?: string[] }): void {
  if (!openWindow) {
    const timer = setTimeout(closeWindow, COALESCE_WINDOW_MS);
    timer.unref();
    openWindow = { nodes: new Set(), checks: new Set() };
  }
  for (const node of change.nodes ?? []) openWindow.nodes.add(node);
  for (const check of change.checks ?? []) openWindow.checks.add(check);
}

/**
 * Puts the lines center has just stored for `runId` on every open browser socket, now. An empty batch
 * sends nothing. Called AFTER the lines were stored, so a screen that reads the run again finds at least
 * what it was just shown.
 *
 * Consumers: `run-frames.ts`, for each `run.output` batch it stores.
 */
export function sendRunOutput(runId: string, lines: CerberusRunLine[]): void {
  if (lines.length === 0) return;
  sendToBrowsers({ kind: 'cerberus_run_output', runId, lines });
}
