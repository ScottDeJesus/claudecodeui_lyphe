import { chatCredential } from '@/modules/chat-commands/index.js';
import { projectsDb, sessionUserStateDb, sessionsDb } from '@/modules/database/index.js';
import { providerRuntimeService } from '@/modules/providers/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type {
  ChatToolsetLaunch,
  SessionToolsetsChangedEvent,
  SessionToolsetsView,
  ToolsetDefinition,
  ToolsetServerOutcome,
  ToolsetSwitchResult,
  ToolsetSyncOutcome,
} from '@/shared/toolset-types.js';
import { AppError, loopbackApiOrigin } from '@/shared/utils.js';

import { toolsetPointer } from './toolsets.pointer.js';
import { SET_NAME_PATTERN, readToolsetRegistry, resolveToolsetsFile } from './toolsets.registry.js';

/**
 * Tool sets' verbs: the launch hook, the view of one chat's sets, and the switch.
 *
 * THE RULE THEY ALL KEEP: a caller names a set and nothing else. The definitions are the box file's
 * (`toolsets.registry.ts`), a chat's on-sets are a column on its own `sessions` row, and no verb here
 * takes a server config, so a session can switch a set that is defined and never define one.
 *
 * Consumed by `toolsets.routes.ts` (both doors) and `toolsets.module.ts`, which registers `launchFor`
 * with the Claude runtime. Every other module is reached through its barrel. The credential a chat
 * carries is `chat-commands`', shared with the other command doors; this file only hands it to a launch.
 */

type ChatRow = NonNullable<ReturnType<typeof sessionsDb.getSessionById>>;
type RegistryReading = { file: string; sets: ToolsetDefinition[]; error: string | null };

// The last unreadable-registry message `launchFor` logged. A broken file is read by every chat that
// launches, so logging each read would write the same line a hundred times; a changed message is a
// new defect and is logged once.
let lastLoggedRegistryMessage: string | null = null;

const NAME_RULE = 'A tool set name is lowercase letters, digits, "_" and "-", starting with a letter or digit, up to 32 characters.';

/** The box file as the view needs it: a defect is data to show, not an exception to throw. */
function readRegistryForView(): RegistryReading {
  try {
    const { file, sets } = readToolsetRegistry();
    return { file, sets, error: null };
  } catch (error) {
    if (error instanceof AppError && error.code === 'TOOLSETS_REGISTRY_INVALID') {
      return { file: resolveToolsetsFile(), sets: [], error: error.message };
    }
    throw error;
  }
}

/** The chat's row, or the refusal for a session that is missing or is not a Claude chat. */
function requireClaudeChat(appSessionId: string): ChatRow {
  const row = sessionsDb.getSessionById(appSessionId);
  if (!row) {
    throw new AppError('No chat has that session id.', { code: 'SESSION_NOT_FOUND', statusCode: 404 });
  }
  if (row.provider !== 'claude') {
    throw new AppError('Tool sets are for Claude chats only.', { code: 'TOOLSETS_CLAUDE_ONLY', statusCode: 400 });
  }
  return row;
}

/** The Cerberus node a chat's project runs on, or null when it runs on this box. */
function nodeOf(row: ChatRow): string | null {
  return row.project_path ? projectsDb.nodeForPath(row.project_path) : null;
}

function buildView(row: ChatRow, registry: RegistryReading): SessionToolsetsView {
  const node = nodeOf(row);
  const onNames = new Set(sessionUserStateDb.getToolsets(row.session_id) ?? []);
  const definedNames = new Set(registry.sets.map((set) => set.name));

  return {
    sessionId: row.session_id,
    availability: node === null ? 'available' : 'node',
    node,
    sets: registry.sets.map((set) => ({
      name: set.name,
      description: set.description,
      servers: Object.keys(set.mcpServers),
      on: onNames.has(set.name),
    })),
    // With the file unreadable nothing is known to be defined, so every on-name would read as a
    // stray; the view says the file is broken and lists no strays instead.
    strays: registry.error === null ? [...onNames].filter((name) => !definedNames.has(name)).sort() : [],
    registryError: registry.error,
    registryFile: registry.file,
  };
}

function logUnreadableRegistryOnce(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message === lastLoggedRegistryMessage) return;
  lastLoggedRegistryMessage = message;
  console.warn(`[toolsets] the tool-set file cannot be read, so chats launch without their sets: ${message}`);
}

/**
 * The hook the Claude runtime asks at every launch (`useChatToolsets({ launchFor })`).
 *
 * EVERY Claude chat on this box with an app session id carries the two variables, whatever the
 * registry holds: a chat that started before the box's first set was registered can still switch it
 * on. A node's chat carries none — a stdio command names this box's paths, and the command there
 * could not reach this box's loopback. `servers` is null (nothing in play, no control request) for
 * a chat that never switched a set and for an unreadable registry, which never breaks a launch.
 */
async function launchFor(input: { appSessionId: string | null; onNode: boolean }): Promise<ChatToolsetLaunch> {
  if (!input.appSessionId || input.onNode) return { env: {}, servers: null, promptLine: null };

  const env = {
    CLOUDCLI_TOOLSET_URL: loopbackApiOrigin(),
    CLOUDCLI_TOOLSET_TOKEN: chatCredential(input.appSessionId),
  };

  let sets: ToolsetDefinition[];
  try {
    sets = readToolsetRegistry().sets;
  } catch (error) {
    logUnreadableRegistryOnce(error);
    return { env, servers: null, promptLine: null };
  }

  const promptLine = toolsetPointer(sets);
  const onNames = sessionUserStateDb.getToolsets(input.appSessionId);
  if (onNames === null) return { env, servers: null, promptLine };

  // Set-name order, because the runtime digests this map's JSON to learn whether a process already
  // carries it. Server names are unique on the box, so no entry overwrites another; `fromEntries`
  // because a server may legally be named `__proto__`.
  const servers = Object.fromEntries(
    sets
      .filter((set) => onNames.includes(set.name))
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
      .flatMap((set) => Object.entries(set.mcpServers)),
  );
  return { env, servers, promptLine };
}

/** What a chat's tool sets look like right now. */
function view(appSessionId: string): SessionToolsetsView {
  return buildView(requireClaudeChat(appSessionId), readRegistryForView());
}

/**
 * One frame to every open socket after a switch that changed the on-sets, in the shape of
 * `broadcastNotesChanged`: stringify once, skip a socket that is not open, catch per client so one
 * dead socket does not cost the rest their frame.
 */
function broadcastToolsetsChanged(sessionId: string): void {
  const message = JSON.stringify({ kind: 'session_toolsets_changed', sessionId, at: Date.now() } satisfies SessionToolsetsChangedEvent);

  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) return;

    try {
      client.send(message);
    } catch (error) {
      console.error(
        `[toolsets] could not send a session_toolsets_changed frame to a client: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

/** What became of each of the switched set's servers, from the runtime's answer to the sync. */
function serverOutcomes(
  serverNames: string[],
  on: boolean,
  sync: ToolsetSyncOutcome,
): { live: ToolsetSwitchResult['live']; servers: ToolsetServerOutcome[] } {
  if (!sync.live) {
    return { live: 'next-message', servers: serverNames.map((name) => ({ name, outcome: 'pending' })) };
  }
  if (!sync.confirmed) {
    return {
      live: 'unconfirmed',
      servers: serverNames.map((name) => ({ name, outcome: 'unconfirmed', detail: sync.reason })),
    };
  }

  return {
    live: 'applied',
    servers: serverNames.map((name): ToolsetServerOutcome => {
      if (on) {
        // `hasOwn`, not `in`: a server may legally be named `toString` or `__proto__` (the registry
        // allows it), and `in` would find the name on `Object.prototype` and report a connected server failed.
        if (Object.hasOwn(sync.errors, name)) return { name, outcome: 'failed', detail: sync.errors[name] };
        return { name, outcome: sync.added.includes(name) ? 'connected' : 'unchanged' };
      }
      return { name, outcome: sync.removed.includes(name) ? 'removed' : 'unchanged' };
    }),
  };
}

/**
 * Switches one set on or off for one chat, pushes the change into the chat's live process, and
 * answers what became of each of the set's servers. The caller sends a NAME; `set` is `unknown`
 * because the command door passes its body's field through unjudged and this is where it is judged.
 */
async function switchSet(appSessionId: string, set: unknown, on: boolean): Promise<ToolsetSwitchResult> {
  const row = requireClaudeChat(appSessionId);
  const node = nodeOf(row);
  if (node !== null) {
    throw new AppError(`This chat runs on ${node}; tool sets are this box's own.`, {
      code: 'TOOLSETS_NOT_ON_THIS_BOX',
      statusCode: 409,
      details: { node },
    });
  }

  const registry = readToolsetRegistry();
  if (typeof set !== 'string' || !SET_NAME_PATTERN.test(set)) {
    throw new AppError(NAME_RULE, { code: 'TOOLSET_NAME_INVALID', statusCode: 400 });
  }

  const definition = registry.sets.find((candidate) => candidate.name === set);
  const storedNames = sessionUserStateDb.getToolsets(row.session_id);
  const currentNames = [...new Set(storedNames ?? [])].sort();
  // `off` takes a name the box still defines or one of this chat's strays; `on` only a defined one.
  if (!definition && !(!on && currentNames.includes(set))) {
    throw new AppError(`No tool set named "${set}" is defined on this box.`, {
      code: 'TOOLSET_NOT_DEFINED',
      statusCode: 404,
      details: { defined: registry.sets.map((candidate) => candidate.name) },
    });
  }

  const nextNames = on
    ? [...new Set([...currentNames, set])].sort()
    : currentNames.filter((name) => name !== set);
  const changed = nextNames.join('\n') !== currentNames.join('\n');
  if (changed && !sessionUserStateDb.setToolsets(row.session_id, nextNames)) {
    throw new AppError('No chat has that session id.', { code: 'SESSION_NOT_FOUND', statusCode: 404 });
  }

  // A stray has no servers the box still knows, so a switch of one names none.
  const serverNames = definition ? Object.keys(definition.mcpServers) : [];
  // A chat whose row is still NULL has nothing in play, so there is nothing to push and nothing pending.
  const outcome =
    storedNames === null && !changed
      ? { live: 'applied' as const, servers: serverNames.map((name): ToolsetServerOutcome => ({ name, outcome: 'unchanged' })) }
      : serverOutcomes(serverNames, on, await providerRuntimeService.syncToolsets('claude', row.session_id));

  if (changed) broadcastToolsetsChanged(row.session_id);

  return {
    set,
    on,
    changed,
    live: outcome.live,
    servers: outcome.servers,
    view: buildView(row, readRegistryForView()),
  };
}

export const toolsetsService = { launchFor, view, switchSet };
