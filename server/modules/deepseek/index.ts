import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { createDeepseekKeyReader } from './deepseek-key.js';

// createDeepseekModule: used by the server entrypoint to mount the authenticated DeepSeek balance
// at `/api/deepseek` — the money left on the account this host's DeepSeek Flash builds spend.
export { createDeepseekModule } from './deepseek.module.js';

/**
 * The DeepSeek key, as a reader the balance route and a spawning module share.
 *
 * Consumer: `server/modules/kanban-metis`, which hands the key to a board's Metis child as
 * `ANTHROPIC_AUTH_TOKEN` when that board's own switch is on. It is the ONE TypeScript-side reader
 * of `DEEPSEEK_API_KEY` — nothing in that module opens a `.env` or names the variable itself.
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
