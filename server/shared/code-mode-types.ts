// ---------------------------
//----------------- CODE MODE CONTRACTS ------------
// The shapes Code Mode for chats hands across the provider runtime's seam, in one home of their own.
//
// It is a SIBLING of `server/shared/types.ts` rather than an addition to it, for the same reason
// `toolset-types.ts` is: that file is past the house ceiling for a module, and a lane that owns a
// handful of shapes keeps them where the lane's own files can read them without opening it.
//
// NEITHER shape crosses a wire to the client, so `src/shared` has no mirror of this file.
//
// `server/shared/types.ts` opens it only for the one field it carries, `ProviderRuntimeContext.codeMode`.

/**
 * What the code-mode module answers the Claude runtime for one launch. Produced by the module's `launchFor` (from the house's `code-mode config --chat` verb's last stdout line); read by the runtime, which on `on: true` replaces the chat's tool list and MCP servers with these.
 */
export type ChatCodeModeLaunch =
  | { on: false }
  | {
      on: true;
      /** Built-in tools the chat keeps; this list replaces the preset, so anything unnamed is off. */
      tools: string[];
      /** The one stdio MCP server `cm`, the house's search/execute server. */
      server: { command: string; args: string[] };
      /** Text appended to the system prompt. */
      prompt: string;
      /** Variables added to the CLI's environment. */
      env: Record<string, string>;
    };

/**
 * The two hooks the code-mode module registers with the provider runtime (`useChatCodeMode`); always present on the context, inert until registered.
 */
export type ChatCodeModeHooks = {
  /** `servers` is the chat's own MCP server map plus its on tool sets' servers; `{}` when there are none. */
  launchFor(input: { appSessionId: string | null; onNode: boolean; cwd: string; servers: Record<string, unknown> }): Promise<ChatCodeModeLaunch>;
  /** Tells the house a Code Mode chat's server map changed, so its `server.json` gets rewritten; rejects with the reason when it could not be. */
  serversChanged(input: { appSessionId: string; servers: Record<string, unknown> }): Promise<void>;
};
