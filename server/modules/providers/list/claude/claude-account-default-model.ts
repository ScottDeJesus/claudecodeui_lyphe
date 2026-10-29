import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { claudeConfigDir } from '@/shared/utils.js';

import { CLAUDE_MODEL_VALUE_BY_ALIAS, type ClaudeModelAlias } from './claude-model-options.js';

/**
 * The model the account runs on when nothing names one, as one of the house's model names: the `model` of the CLI's
 * user settings (`<config dir>/settings.json`, `claude-fable-5-1[1m]` on this machine) read down to its family (`fable`).
 *
 * WHY A CALLER ASKS. A turn this server sends with no model does NOT run on that default: the Claude runtime fills in
 * the catalog's own (`CLAUDE_DEFAULT_MODEL`, `opus[1m]`, the picker's) so every chat runs on a model the picker can show.
 * A caller that means "the account default" has to say which model that is, and this is how it learns.
 *
 * THE NAME. The setting may state an alias (`opus`, `sonnet[1m]`) or a pinned id (`claude-fable-5-1[1m]`). Either way the
 * FAMILY is read out of it and answered as the house's name for that family, never the generation, so the chat is stored
 * as `fable` like every other chat on that family and follows the family when a release moves it.
 *
 * Read on every call and never kept: the operator changes the setting by hand and the next chat opened follows it.
 * Null when no setting is held, the file cannot be read, or it names a family the house has no name for; the caller then
 * sends no model and the runtime's own default runs. A file that exists but cannot be used is logged with its path.
 *
 * Consumer: the companion module (`companion-send.ts`, for a new chat whose `model` she left out), through the
 * providers barrel.
 */
export async function readAccountDefaultModelAlias(): Promise<ClaudeModelAlias | null> {
  const settingsPath = path.join(claudeConfigDir(), 'settings.json');
  let named: unknown;
  try {
    named = (JSON.parse(await readFile(settingsPath, 'utf8')) as { model?: unknown } | null)?.model;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[Claude] the account default model could not be read from its settings', { settingsPath, error });
    }
    return null;
  }
  if (typeof named !== 'string' || named.trim() === '') return null;

  const words = named.toLowerCase().split(/[^a-z0-9]+/);
  const alias = (Object.keys(CLAUDE_MODEL_VALUE_BY_ALIAS) as ClaudeModelAlias[]).find((candidate) => words.includes(candidate));
  if (!alias) console.error('[Claude] the account default model names a family the house has no name for; a chat will run on the runtime default', { settingsPath, named });
  return alias ?? null;
}
