/**
 * The installed Claude CLI's own command list — what the engine advertises to every SDK client —
 * read once per CLI version and kept at `~/.cloudcli/claude-command-catalog.json`
 * (`{cliVersion, readAt, commands, terminalCommands}`).
 *
 * The read is the shared engine-catalog mechanism (`claude-engine-catalog.ts`) asking
 * `supportedCommands()` of an idle CLI with no settings source loaded: measured 2026-10-08 on Claude
 * Code 2.1.295, 55 records in 695 ms, all `builtin: true`. Skills, custom commands, plugins and MCP
 * prompts are not in that answer — the palette already lists those from disk — so the list cannot go
 * stale through a skill or plugin change, and the CLI version is its whole key.
 *
 * `terminalCommands` is the engine's own word on which of those commands are bound to a local
 * terminal. It is NOT in the idle read: the CLI emits it only on a turn's `init` system message
 * (`terminal_slash_commands`), so the chat runtime hands it here (`noteTerminalCommands`) and it is
 * kept beside the version of the CLI that sent it. Nothing is typed in: until a chat has run on a CLI
 * version, that version has no terminal-only commands, and none is badged.
 *
 * When the read fails or the CLI does not answer within the wait cap, the last stored list of any
 * version is served, else an empty one — the palette always opens, with one `[Claude commands]` line in
 * the log saying why.
 *
 * consumers: providers/index.ts → the commands module (`POST /api/commands/list`'s engine group);
 * claude-runtime.provider.js (the init frame's terminal-only set).
 */
import os from 'node:os';
import path from 'node:path';

import type { ClaudeCommandCatalog, ClaudeEngineCommand } from '@/shared/types.js';

import { EngineCatalog } from './claude-engine-catalog.js';

const EMPTY_COMMAND_CATALOG: ClaudeCommandCatalog = { commands: [], terminalCommands: new Set() };

const isString = (value: unknown): value is string => typeof value === 'string';

/** One record off the CLI or off the cache file as an engine command — or nothing, for a record with no usable name. */
function parseEngineCommand(record: unknown): ClaudeEngineCommand[] {
  if (!record || typeof record !== 'object') return [];
  const { name, description, argumentHint, aliases } = record as Record<string, unknown>;
  if (!isString(name) || name.length === 0) return [];
  return [{
    name,
    description: isString(description) ? description : '',
    argumentHint: isString(argumentHint) ? argumentHint : '',
    aliases: Array.isArray(aliases) ? aliases.filter(isString) : [],
  }];
}

/** The served catalog from the kept records and the terminal-only names kept beside them; null when no record is usable. */
function buildCommandCatalog(records: unknown[], extras: Record<string, unknown>): ClaudeCommandCatalog | null {
  const commands = records.flatMap(parseEngineCommand);
  if (commands.length === 0) return null;
  const terminalNames = Array.isArray(extras.terminalCommands) ? extras.terminalCommands.filter(isString) : [];
  return { commands, terminalCommands: new Set(terminalNames) };
}

let commandCatalog: EngineCatalog<ClaudeCommandCatalog> | null = null;

/** Created on first use, never at import — for the reason `claude-model-catalog.ts` gives (the cli-version import cycle). */
function getCommandCatalog(): EngineCatalog<ClaudeCommandCatalog> {
  commandCatalog ??= new EngineCatalog<ClaudeCommandCatalog>({
    logTag: 'Claude commands',
    noun: 'command catalog',
    usableEntry: 'command',
    // `CLOUDCLI_CLAUDE_COMMAND_CATALOG_PATH` is read on every call, so a probe that redirects it gets its own file.
    storePath: () => process.env.CLOUDCLI_CLAUDE_COMMAND_CATALOG_PATH
      || path.join(os.homedir(), '.cloudcli', 'claude-command-catalog.json'),
    recordsKey: 'commands',
    read: (instance) => instance.supportedCommands(),
    build: buildCommandCatalog,
    describe: (catalog) => `${catalog.commands.length} commands`,
    fallback: EMPTY_COMMAND_CATALOG,
    fallbackName: 'an empty list',
  });
  return commandCatalog;
}

/**
 * The engine's command list for the installed CLI, with its terminal-only names.
 *
 * Answers from memory in the steady state; a caller waits at most three seconds on a read in flight
 * and is then served what is already known (the last stored list, else an empty one). Never rejects.
 *
 * consumer: the commands module (`POST /api/commands/list`), through providers/index.ts, to fill the
 * palette's Claude Code group.
 */
export async function readClaudeCommandCatalog(): Promise<ClaudeCommandCatalog> {
  return getCommandCatalog().serve();
}

/**
 * Keeps the `terminal_slash_commands` a chat's `init` frame carried, under the CLI version that sent it.
 *
 * `runningVersion` is the frame's own `claude_code_version` — the running process's, which can be
 * older than the binary now installed; its list is then not kept, since it describes another version
 * than the one the palette is serving. Writes only when the set changed, so a frame per turn costs a
 * memory comparison. Never rejects: the chat loop calls it without waiting.
 *
 * consumer: claude-runtime.provider.js (the chat loop's `init` branch).
 */
export async function noteTerminalCommands(runningVersion: unknown, names: unknown): Promise<void> {
  try {
    if (!isString(runningVersion) || runningVersion.length === 0 || !Array.isArray(names)) return;
    const terminalCommands = names.filter(isString);
    const kept = await getCommandCatalog().keepExtras(runningVersion, { terminalCommands });
    if (kept) {
      console.log(`[Claude commands] terminal-only on Claude Code ${runningVersion}, from a chat's init frame: ${terminalCommands.join(', ')}`);
    }
  } catch (error) {
    console.warn(`[Claude commands] could not note the terminal-only commands: ${error instanceof Error ? error.message : String(error)}`);
  }
}
