import type { RndFeatureReading, RndMeasure, RndReading, RndReadingsAnalytics } from '../../../shared/analytics-types.js';

import { runVerbForJson } from './verb.js';
import type { VerbWords } from './verb.js';

const RND_WORDS: VerbWords = { verb: 'dispatcher', command: 'dispatcher rnd readings' };

/**
 * The R&D section: the dispatcher's own document of every feature adopted from R&D (dispatcher rnd readings --json),
 * carried key for key as printed.
 *
 * The dispatcher holds each measure, takes each reading when the document is asked for and says how it stands against
 * its baseline; this reader computes none of it and compares nothing. It narrows every key by its type, so a key the
 * screen reads that went missing or changed its type is a sentence here. The section has no window: days is not used.
 * Every failure throws one sentence.
 */
export function createRndReader(bin: string): (days: number) => Promise<RndReadingsAnalytics> {
  return async () => narrowAnswer(await runVerbForJson(bin, ['rnd', 'readings', '--json'], RND_WORDS));
}

type Answer = Record<string, unknown>;

function isRecord(value: unknown): value is Answer {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function misshapen(key: string): Error {
  return new Error('dispatcher rnd readings answered without ' + key + ' of the type the screen reads');
}

function textAt(row: Answer, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw misshapen(key);
  return value;
}

function textOrNullAt(row: Answer, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== 'string') throw misshapen(key);
  return value;
}

function numberAt(row: Answer, key: string): number {
  const value = row[key];
  if (typeof value !== 'number') throw misshapen(key);
  return value;
}

/** One of the words the document may hold under a key, as written. */
function wordAt<Word extends string>(row: Answer, key: string, words: readonly Word[]): Word {
  const value = row[key];
  const found = words.find((word) => word === value);
  if (found === undefined) throw misshapen(key);
  return found;
}

function measureOf(feature: Answer): RndMeasure | null {
  const measure = feature.measure;
  if (measure === null) return null;
  if (!isRecord(measure)) throw misshapen('measure');
  return {
    says: textAt(measure, 'says'),
    promised: textAt(measure, 'promised'),
    baseline: numberAt(measure, 'baseline'),
    unit: textAt(measure, 'unit'),
    better: wordAt(measure, 'better', ['lower', 'higher']),
    section: textOrNullAt(measure, 'section'),
    set_at: textAt(measure, 'set_at'),
    set_by: textAt(measure, 'set_by'),
  };
}

function readingOf(feature: Answer): RndReading | null {
  const reading = feature.reading;
  if (reading === null) return null;
  if (!isRecord(reading)) throw misshapen('reading');
  return {
    value: numberAt(reading, 'value'),
    detail: textOrNullAt(reading, 'detail'),
    against: wordAt(reading, 'against', ['better', 'level', 'worse']),
  };
}

function featureOf(feature: unknown): RndFeatureReading {
  if (!isRecord(feature)) throw misshapen('features');
  return {
    candidate: textAt(feature, 'candidate'),
    plan: textAt(feature, 'plan'),
    title: textAt(feature, 'title'),
    epic: textOrNullAt(feature, 'epic'),
    word: textOrNullAt(feature, 'word'),
    adopted_at: textAt(feature, 'adopted_at'),
    measure: measureOf(feature),
    state: wordAt(feature, 'state', ['none', 'not_built', 'read', 'failed']),
    reading: readingOf(feature),
    fault: textOrNullAt(feature, 'fault'),
  };
}

function narrowAnswer(answer: unknown): RndReadingsAnalytics {
  if (!isRecord(answer)) throw new Error('dispatcher rnd readings answered something other than one JSON object');
  const features = answer.features;
  if (!Array.isArray(features)) throw misshapen('features');
  return { generated_at: textAt(answer, 'generated_at'), features: features.map(featureOf) };
}
