/**
 * The installed Claude CLI's own model catalog: read once per CLI version, kept on disk.
 *
 * The read, the version-keyed disk record, the 3 s wait cap and the failed-read retry are the shared
 * engine-catalog mechanism (`claude-engine-catalog.ts`; its header is the account of each). This file
 * is the model catalog's own half: the question it asks (`supportedModels()`), the file it keeps
 * (`~/.cloudcli/claude-model-catalog.json`, `{cliVersion, readAt, models}` plus one `ranAs:<word>` extra
 * for each of the house's model words a chat has run under that CLI version), the picker definition
 * built from the CLI's answer and those extras, and the family-named fallback served when nothing was
 * ever read (`CLAUDE_FALLBACK_MODELS`).
 *
 * The record on disk is the CLI's own answer, not the picker built from it, so a rule change in
 * `buildClaudeModelsDefinition` applies without a re-read. `getSupportedModels` sits on the send path
 * (effort validation), which is why a caller never waits out a CLI that will not answer.
 *
 * consumer: claude-models.provider.ts (ClaudeProviderModels.getSupportedModels)
 */
import os from 'node:os';
import path from 'node:path';

import type { ProviderModelsDefinition } from '@/shared/types.js';

import { EngineCatalog } from './claude-engine-catalog.js';
import { CLAUDE_FALLBACK_MODELS, buildClaudeModelsDefinition, ranAsExtraOf } from './claude-model-options.js';

let modelCatalog: EngineCatalog<ProviderModelsDefinition> | null = null;

/**
 * Created on first use, never at import. The shared mechanism imports the cli-version barrel, whose
 * module imports the websocket module, which imports the providers barrel, which imports this file:
 * a cycle that is harmless while an import is only used inside a function. A `new EngineCatalog(...)`
 * at the top level of this file would run before the class has been initialised, in an unlucky entry order.
 */
function getModelCatalog(): EngineCatalog<ProviderModelsDefinition> {
  modelCatalog ??= new EngineCatalog<ProviderModelsDefinition>({
    logTag: 'Claude models',
    noun: 'model catalog',
    usableEntry: 'model the picker can show',
    // `CLOUDCLI_CLAUDE_MODEL_CATALOG_PATH` is read on every call, so a probe that redirects it gets its own file.
    storePath: () => process.env.CLOUDCLI_CLAUDE_MODEL_CATALOG_PATH
      || path.join(os.homedir(), '.cloudcli', 'claude-model-catalog.json'),
    recordsKey: 'models',
    read: (instance) => instance.supportedModels(),
    build: (models, extras) => buildClaudeModelsDefinition(models, extras),
    describe: (definition) => definition.OPTIONS.map((option) => option.label).join(', '),
    fallback: CLAUDE_FALLBACK_MODELS,
    fallbackName: 'the built-in family list',
  });
  return modelCatalog;
}

/**
 * The Claude picker's definition, from the installed CLI's own catalog.
 *
 * Answers from memory in the steady state. A caller that arrives while the CLI is being read waits at
 * most three seconds and is then served what is already known; the read carries on and serves the
 * next caller.
 *
 * consumer: claude-models.provider.ts (ClaudeProviderModels.getSupportedModels)
 */
export async function readClaudeModelsDefinition(): Promise<ProviderModelsDefinition> {
  return getModelCatalog().serve();
}

/**
 * Keeps the model id a chat's `init` frame reported for the model word the chat runs under (`fable` →
 * `claude-fable-5-2`), under the CLI version that sent the frame, so the picker names the generation
 * that word runs rather than the one a pinned catalog entry states (`buildClaudeModelsDefinition`).
 *
 * `runningVersion` is the frame's own `claude_code_version` — the running process's, which can be older
 * than the binary now installed; its answer is then not kept, since a word may run another model on
 * another version. Only the house's own words are kept, and only an id of the word's family
 * (`ranAsExtraOf`). Writes only when the id changed, so a frame per turn costs a memory comparison.
 * Never rejects: the chat loop calls it without waiting.
 *
 * consumer: claude-runtime.provider.js (the chat loop's `init` branch).
 */
export async function noteModelRanAs(runningVersion: unknown, word: unknown, reportedId: unknown): Promise<void> {
  try {
    if (typeof runningVersion !== 'string' || runningVersion.length === 0) return;
    const extra = ranAsExtraOf(word, reportedId);
    if (!extra) return;
    const kept = await getModelCatalog().keepExtras(runningVersion, extra);
    if (kept) {
      console.log(`[Claude models] on Claude Code ${runningVersion}, from a chat's init frame: ${String(word)} ran as ${String(reportedId)}`);
    }
  } catch (error) {
    console.warn(`[Claude models] could not note what a model word ran as: ${error instanceof Error ? error.message : String(error)}`);
  }
}
