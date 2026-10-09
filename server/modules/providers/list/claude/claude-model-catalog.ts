/**
 * The installed Claude CLI's own model catalog: read once per CLI version, kept on disk.
 *
 * The read, the version-keyed disk record, the 3 s wait cap and the failed-read retry are the shared
 * engine-catalog mechanism (`claude-engine-catalog.ts`; its header is the account of each). This file
 * is the model catalog's own half: the question it asks (`supportedModels()`), the file it keeps
 * (`~/.cloudcli/claude-model-catalog.json`, `{cliVersion, readAt, models}`), the picker definition built
 * from the CLI's answer, and the family-named fallback served when nothing was ever read
 * (`CLAUDE_FALLBACK_MODELS`).
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
import { CLAUDE_FALLBACK_MODELS, buildClaudeModelsDefinition } from './claude-model-options.js';

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
    build: (models) => buildClaudeModelsDefinition(models),
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
