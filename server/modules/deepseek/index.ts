import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { createDeepseekKeyReader } from './deepseek-key.js';

// createDeepseekModule: used by the server entrypoint to mount the authenticated DeepSeek balance
// at `/api/deepseek` — the money left on the account this host's DeepSeek Flash builds spend.
export { createDeepseekModule } from './deepseek.module.js';

// DEEPSEEK_BASE_URL, DEEPSEEK_MODEL: used by `kanban-metis` (a Flash board's Metis) and `companion` (Kaylee on
// DeepSeek) to point a child's CLI at DeepSeek's Anthropic-compatible endpoint under the model name it needs.
export { DEEPSEEK_BASE_URL, DEEPSEEK_MODEL } from './deepseek-endpoint.js';

/**
 * The DeepSeek key, as a reader the balance route and a spawning module share.
 *
 * Consumers: `server/modules/kanban-metis`, which hands the key to a board's Metis child as
 * `ANTHROPIC_AUTH_TOKEN` when that board's own switch is on, and `server/modules/companion`, which does
 * the same for Kaylee's CLI while her model is DeepSeek (and checks the key is held before a save of that
 * model is accepted). It is the ONE TypeScript-side reader of `DEEPSEEK_API_KEY` — nothing in either
 * module opens a `.env` or reads the variable itself (a sentence that tells the operator which key is
 * missing names it, and that is all).
 * `~/.claude/hooks/plan_runner/deepseek.py` is the Python-side reader of the same name out of the
 * same file, and a second .env parser here would be a second answer to "which key does this host
 * hold".
 *
 * Composed EXACTLY as `deepseek.module.ts` composes its own, down to the `.env` resolved from the
 * APPLICATION root rather than `process.cwd()`: the dev supervisor starts this server with its own
 * working directory and a compiled install runs from a directory nothing guarantees, so a relative
 * path would name one file under `tsx` and another under `dist-server`. Two readers of one key
 * disagreeing is two different keys as far as every caller can tell.
 *
 * Read on every call, never cached — see `createDeepseekKeyReader` for why that is load-bearing.
 */
export const readDeepseekApiKey: () => Promise<string | null> = createDeepseekKeyReader({
  envPath: path.join(findApplicationRoot(getModuleDirectory(import.meta.url)), '.env'),
  readEnvironment: () => process.env,
  readFileImpl: (filePath) => readFile(filePath, 'utf8'),
});
