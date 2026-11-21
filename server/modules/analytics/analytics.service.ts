import type { AnalyticsAnswer, AnalyticsSectionList } from '../../shared/analytics-types.js';
import { AppError } from '../../shared/utils.js';

import type { AnalyticsReaders } from './sections/index.js';

/** The window a request that names none is answered for. */
const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
/** A leap year: the longest window the house verb answers. */
const MAX_DAYS = 366;
/** A window as a query string spells it: digits only, so `7.5`, `-3`, `1e2` and ` 7` are all refused. */
const WHOLE_NUMBER = /^[0-9]{1,3}$/;

export type AnalyticsService = {
  list(): AnalyticsSectionList;
  read(sectionInput: unknown, daysInput: unknown): Promise<AnalyticsAnswer<unknown>>;
};

/**
 * Every judgement the area makes about a request: which section, which window, and what a reader's
 * failure means to the caller. The readers compute nothing and judge nothing; the routes carry.
 */
export function createAnalyticsService(readers: AnalyticsReaders): AnalyticsService {
  return {
    list: () => ({ sections: Object.keys(readers).map((id) => ({ id })) }),

    async read(sectionInput, daysInput) {
      const section = knownSection(readers, sectionInput);
      const days = windowDays(daysInput);
      try {
        return { section, days, data: await readers[section](days) };
      } catch (error) {
        const sentence = error instanceof Error ? error.message : String(error);
        console.error(`[analytics] the ${section} section could not be read for ${days} days: ${sentence}`);
        throw new AppError(sentence, { code: 'ANALYTICS_SOURCE_FAILED', statusCode: 502 });
      }
    },
  };
}

/** The id as one string a reader holds — own keys only, so `constructor` names no section. */
function knownSection(readers: AnalyticsReaders, sectionInput: unknown): string {
  if (typeof sectionInput === 'string' && Object.hasOwn(readers, sectionInput)) return sectionInput;
  throw new AppError(`No analytics section is called ${JSON.stringify(sectionInput)}.`, {
    code: 'ANALYTICS_SECTION_UNKNOWN',
    statusCode: 404,
  });
}

/** `days` absent is the default; anything but one whole number from 1 to 366 is refused. */
function windowDays(daysInput: unknown): number {
  if (daysInput === undefined) return DEFAULT_DAYS;
  const days = typeof daysInput === 'string' && WHOLE_NUMBER.test(daysInput) ? Number(daysInput) : Number.NaN;
  if (days >= MIN_DAYS && days <= MAX_DAYS) return days;
  throw new AppError(`days must be a whole number from ${MIN_DAYS} to ${MAX_DAYS}.`, {
    code: 'ANALYTICS_DAYS_INVALID',
    statusCode: 400,
  });
}
