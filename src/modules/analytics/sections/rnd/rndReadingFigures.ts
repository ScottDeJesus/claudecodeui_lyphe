import { ANALYTICS_SECTIONS } from '@/modules/analytics/sections/registry';
import type { AnalyticsSection } from '@/modules/analytics/sections/registry';
import type { RndFeatureReading, RndMeasure, RndReading, RndReadingsAnalytics } from '@/shared/analytics-types';
import type { Tone } from '@/shared/types';

// The R&D section's narrowing, and the words and tone a row needs. Nothing here compares a number: how a reading
// stands against its baseline is the dispatcher's word (against), and this file only says it.

/**
 * The answer of GET /api/analytics/rnd as the section draws it, or null for data that is not that shape, which the
 * read then treats as no answer.
 */
export function narrowRndReadings(data: unknown): RndReadingsAnalytics | null {
  if (!isRecord(data) || typeof data.generated_at !== 'string' || !Array.isArray(data.features)) return null;
  const features = data.features.map(narrowFeature);
  const whole = features.filter((feature): feature is RndFeatureReading => feature !== null);
  // One misshapen row makes the answer misshapen: a row dropped in silence would read as a feature never adopted.
  if (whole.length !== features.length) return null;
  return { generated_at: data.generated_at, features: whole };
}

type Fields = Record<string, unknown>;

const STATES = ['none', 'not_built', 'read', 'failed'] as const;
const AGAINSTS = ['better', 'level', 'worse'] as const;
const BETTERS = ['lower', 'higher'] as const;

function narrowFeature(row: unknown): RndFeatureReading | null {
  if (!isRecord(row)) return null;
  const { candidate, plan, title, epic, word, adopted_at, state, fault } = row;
  if (typeof candidate !== 'string' || typeof plan !== 'string' || typeof title !== 'string' || typeof adopted_at !== 'string') return null;
  if (!isTextOrNull(epic) || !isTextOrNull(word) || !isTextOrNull(fault) || !isOneOf(state, STATES)) return null;
  const measure = row.measure === null ? null : narrowMeasure(row.measure);
  const reading = row.reading === null ? null : narrowReading(row.reading);
  if ((row.measure !== null && measure === null) || (row.reading !== null && reading === null)) return null;
  return { candidate, plan, title, epic, word, adopted_at, measure, state, reading, fault };
}

function narrowMeasure(value: unknown): RndMeasure | null {
  if (!isRecord(value)) return null;
  const { says, promised, baseline, unit, better, section, set_at, set_by } = value;
  if (typeof says !== 'string' || typeof promised !== 'string' || typeof unit !== 'string') return null;
  if (typeof baseline !== 'number' || !isOneOf(better, BETTERS) || !isTextOrNull(section)) return null;
  if (typeof set_at !== 'string' || typeof set_by !== 'string') return null;
  return { says, promised, baseline, unit, better, section, set_at, set_by };
}

function narrowReading(value: unknown): RndReading | null {
  if (!isRecord(value)) return null;
  const { value: figure, detail, against } = value;
  if (typeof figure !== 'number' || !isTextOrNull(detail) || !isOneOf(against, AGAINSTS)) return null;
  return { value: figure, detail, against };
}

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isOneOf<T extends string>(value: unknown, words: readonly T[]): value is T {
  return words.some((word) => word === value);
}

/** How a reading is toned: better is good, level is quiet, worse is a warning. Never red: a worse number is watched, not broken. */
const AGAINST_TONES = { better: 'positive', level: 'neutral', worse: 'warn' } satisfies Record<RndReading['against'], Tone>;

/** The words that say how a reading stands, each taking the baseline it stands against. */
const AGAINST_KEYS = {
  better: 'analytics.rnd.against.better',
  level: 'analytics.rnd.against.level',
  worse: 'analytics.rnd.against.worse',
} satisfies Record<RndReading['against'], string>;

export function toneOf(against: RndReading['against']): Tone {
  return AGAINST_TONES[against];
}

export function againstKeyOf(against: RndReading['against']): string {
  return AGAINST_KEYS[against];
}

/** How many features read worse than their baseline: the section's one figure, at its heading's end. */
export function worseCountOf(features: RndFeatureReading[]): number {
  return features.filter((feature) => feature.reading?.against === 'worse').length;
}

/** The Analytics section a feature names as its own tab, when the strip holds it; never this section itself. */
export function ownSectionOf(feature: RndFeatureReading): AnalyticsSection | null {
  const id = feature.measure?.section ?? null;
  if (id === null || id === 'rnd') return null;
  return ANALYTICS_SECTIONS.find((row) => row.id === id) ?? null;
}
