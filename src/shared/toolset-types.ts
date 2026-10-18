// ---------------------------
//----------------- TOOL SET CONTRACTS (CLIENT MIRROR) ------------
// The client's view of tool sets: the shapes the composer's section reads off a wire, in one home of
// their own.
//
// It mirrors `server/shared/toolset-types.ts` field for field, and that file is the one place to look
// when a shape here seems wrong. The two edit TOGETHER: a field renamed on one side and not the
// other is a response the composer quietly stops reading. The five server-only types there
// (`ToolsetServerConfig`, `ToolsetDefinition`, `ChatToolsetLaunch`, `ChatToolsetHooks`,
// `ToolsetSyncOutcome`) never cross a wire and are not mirrored.
//
// It imports NOTHING from `server/`: the client tsconfig does not compile server code, and an
// `import type` across that boundary is a bundle that cannot build.
//
// It is a SIBLING of `src/shared/types.ts` for the reason `app-types.ts` beside it is: that file is
// past the house ceiling for a module.

/** One set in a chat's view: its server names and whether this chat has it on. Read by the composer's section. */
export type ToolsetSetView = { name: string; description: string | null; servers: string[]; on: boolean };

/**
 * What a chat's tool sets look like right now (GET /api/toolsets/sessions/:sessionId, and the tail
 * of every switch). Read by the composer's section.
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

/** What became of one server of the switched set. Read by the composer, under a row whose last switch went wrong. */
export type ToolsetServerOutcome = {
  name: string;
  outcome: 'connected' | 'failed' | 'removed' | 'unchanged' | 'pending' | 'unconfirmed';
  /** The CLI's error for 'failed'; the reason for 'unconfirmed'. */
  detail?: string;
};

/** The answer to a switch (PUT /api/toolsets/sessions/:sessionId/sets/:set). Read by the composer's hook. */
export type ToolsetSwitchResult = {
  set: string;
  on: boolean;
  changed: boolean;
  live: 'applied' | 'next-message' | 'unconfirmed';
  /** THIS set's servers. */
  servers: ToolsetServerOutcome[];
  view: SessionToolsetsView;
};

/** The command door's body (POST /api/toolsets-cmd), spelled here so the one wire shape has one client spelling. */
export type ToolsetCommandRequest = { claudeSessionId: string; action: 'list' | 'on' | 'off'; set?: string };

/** The frame that tells every open socket a chat's on-sets changed. Read by the composer's hook, which reads the view again. */
export type SessionToolsetsChangedEvent = { kind: 'session_toolsets_changed'; sessionId: string; at: number };
