import type { McpHttpServerConfig, McpSSEServerConfig, McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';

// ---------------------------
//----------------- TOOL SET CONTRACTS ------------
// The shapes tool sets put on a wire or hand across the provider runtime's seam, in one home of
// their own.
//
// It is a SIBLING of `server/shared/types.ts` rather than an addition to it, for the reason
// `app-types.ts` beside it is: that file is past the house ceiling for a module, and a lane that
// owns a handful of shapes keeps them where the lane's own files can read them without opening it.
//
// The client mirror is `src/shared/toolset-types.ts`. It carries the wire shapes field for field and
// leaves out the five that never cross a wire (`ToolsetServerConfig`, `ToolsetDefinition`,
// `ChatToolsetLaunch`, `ChatToolsetHooks`, `ToolsetSyncOutcome`), so a change to a wire shape here
// without the same change there is a response the composer cannot read: the two are edited together,
// always.
//
// `server/shared/types.ts` is not opened by anything in this lane beyond the one field and the one
// event kind it carries for these shapes (`ProviderRuntimeContext.toolsets`, `session_toolsets_changed`).

/**
 * One server of a set as the box file holds it — handed to `setMcpServers` as-is. Produced by the
 * registry's reader (`toolsets.registry.ts`); read by the hook and the service, which pass it on
 * without looking inside.
 */
export type ToolsetServerConfig = McpStdioServerConfig | McpHttpServerConfig | McpSSEServerConfig;

/**
 * One set the box defines, in file order. Produced by the registry's reader; read by the hook (which
 * merges the on-sets' servers) and the service (which lists the sets and names a set's servers).
 */
export type ToolsetDefinition = {
  name: string;
  description: string | null;
  mcpServers: Record<string, ToolsetServerConfig>;
};

/** One set in a chat's view: its server names and whether this chat has it on. Produced by the service; read by the UI and the command. */
export type ToolsetSetView = { name: string; description: string | null; servers: string[]; on: boolean };

/**
 * What a chat's tool sets look like right now. Produced by the service (GET, and the tail of every
 * switch); read by the composer's section and by `toolset list`.
 */
export type SessionToolsetsView = {
  /** The app session id. */
  sessionId: string;
  availability: 'available' | 'node';
  /** The Cerberus node, when `availability` is 'node'. */
  node: string | null;
  /** Every set the box defines, in file order; empty when `registryError` is set. */
  sets: ToolsetSetView[];
  /** Names on for this chat that the box no longer defines. */
  strays: string[];
  /** Why the box file could not be read. */
  registryError: string | null;
  /** The box file's absolute path. */
  registryFile: string;
};

/**
 * What became of one server of the switched set. Produced by the service from the runtime's sync
 * answer; read by the composer (one line under a failed row) and by the command (one line per server).
 */
export type ToolsetServerOutcome = {
  name: string;
  outcome: 'connected' | 'failed' | 'removed' | 'unchanged' | 'pending' | 'unconfirmed';
  /** The CLI's error for 'failed'; the reason for 'unconfirmed'. */
  detail?: string;
};

/**
 * The answer to a switch. Produced by the service; read by the PUT's caller (the composer) and by the
 * command door's caller (`toolset on|off`).
 */
export type ToolsetSwitchResult = {
  set: string;
  on: boolean;
  changed: boolean;
  live: 'applied' | 'next-message' | 'unconfirmed';
  /** THIS set's servers. */
  servers: ToolsetServerOutcome[];
  view: SessionToolsetsView;
};

/** The command door's body. Produced by `bin/toolset.mjs`; read by the command door, which takes a set NAME only. */
export type ToolsetCommandRequest = { claudeSessionId: string; action: 'list' | 'on' | 'off'; set?: string };

/**
 * What a chat's launch is handed. Produced by the hook (the toolsets module); read by the Claude
 * runtime, which merges `env` and `promptLine` into the launch and hands `servers` to the sync.
 */
export type ChatToolsetLaunch = {
  /** CLOUDCLI_TOOLSET_URL and CLOUDCLI_TOOLSET_TOKEN — empty when inert. */
  env: Record<string, string>;
  /** The on-sets' servers in set-name order; null = nothing in play. */
  servers: Record<string, ToolsetServerConfig> | null;
  /** The pointer the model reads about the sets, or null. */
  promptLine: string | null;
};

/**
 * Tool sets' one hook. Produced by the toolsets module, which registers it at boot through
 * `providerRuntimeService.useChatToolsets`; read by the Claude runtime through its context.
 */
export type ChatToolsetHooks = {
  launchFor(input: { appSessionId: string | null; onNode: boolean }): Promise<ChatToolsetLaunch>;
};

/**
 * What a sync of a chat's process came to. Produced by the Claude runtime (`syncToolsets`); read by
 * the toolsets service, which turns it into the per-server outcomes of a switch.
 */
export type ToolsetSyncOutcome =
  | { live: false }
  | { live: true; confirmed: true; added: string[]; removed: string[]; errors: Record<string, string> }
  | { live: true; confirmed: false; reason: string };

/**
 * The frame that tells every open socket a chat's on-sets changed. Produced by the toolsets service
 * after a switch that changed them; read by the composer's hook, which reads the view again.
 */
export type SessionToolsetsChangedEvent = { kind: 'session_toolsets_changed'; sessionId: string; at: number };
