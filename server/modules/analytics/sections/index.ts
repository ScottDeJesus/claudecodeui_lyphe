import { createCodeModeReader } from './code-mode.js';
import { createRepeatsReader } from './repeats.js';
import { createWebWalkReader } from './web-walk.js';

/** One section's reader: the section's data for the last `days` days, or a throw whose message is the sentence. */
export type AnalyticsReader = (days: number) => Promise<unknown>;
export type AnalyticsReaders = Record<string, AnalyticsReader>;

/** What the readers are handed, resolved once by the composition root. */
export type AnalyticsSources = { codeModeBin: string; webWalkBin: string; healRepeatsBin: string };

/**
 * The reader table: one row per section, keyed by the id the screen's registry uses. A later section
 * adds a file beside `code-mode.ts` whose reader calls its owning module's door, and its row here;
 * the service and the routes need no change.
 */
export function createAnalyticsReaders({ codeModeBin, webWalkBin, healRepeatsBin }: AnalyticsSources): AnalyticsReaders {
  return {
    'code-mode': createCodeModeReader(codeModeBin),
    'web-walk': createWebWalkReader(webWalkBin),
    repeats: createRepeatsReader(healRepeatsBin),
  };
}
