import type { ClaudeCommandCatalog } from '@/shared/types.js';

/** One palette entry for an engine command, in the shape `POST /api/commands/list` serves under `engine`. */
type EngineCommandEntry = {
  name: string;
  description: string;
  argumentHint: string;
  aliases: string[];
  namespace: 'engine';
  metadata: { type: 'terminal' | 'claude-code' };
};

/** Names the engine keeps for itself: the leading `__` marks a command no person is meant to type. */
const ENGINE_INTERNAL_PREFIX = '__';

/**
 * The Claude Code engine's own commands as palette entries, sorted by name.
 *
 * `nativeNames` are the slash names CloudCLI answers itself (`/help`, `/config`, ...): on an exact
 * collision CloudCLI's entry stands and the engine's is dropped, so one name is one thing in the
 * palette. Aliases ride along on the entry and are not entries of their own.
 *
 * Never throws and never rejects: an engine list that cannot be read is an empty group (the catalog
 * has already logged why when its read failed), because the palette must always open.
 *
 * consumer: commands.routes.ts (`POST /api/commands/list`).
 */
export async function listEngineCommands(
  readCatalog: () => Promise<ClaudeCommandCatalog>,
  nativeNames: ReadonlySet<string>,
): Promise<EngineCommandEntry[]> {
  try {
    const catalog = await readCatalog();
    return catalog.commands
      .filter((command) => !command.name.startsWith(ENGINE_INTERNAL_PREFIX) && !nativeNames.has(`/${command.name}`))
      .map((command): EngineCommandEntry => ({
        name: `/${command.name}`,
        description: command.description,
        argumentHint: command.argumentHint,
        aliases: command.aliases,
        namespace: 'engine',
        metadata: { type: catalog.terminalCommands.has(command.name) ? 'terminal' : 'claude-code' },
      }))
      .sort((first, second) => first.name.localeCompare(second.name));
  } catch (error) {
    console.warn(`[Commands] the Claude Code command list could not be read; the engine group is empty: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
