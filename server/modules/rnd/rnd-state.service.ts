import { readDispatcherJson, type DispatcherCommandDependencies } from '@/shared/dispatcher-command.js';

/**
 * The R&D picture: `dispatcher rnd show --json` read and checked field by field at this edge, so everything past it
 * trusts the type. The dispatcher owns every word in it (a candidate's word is derived there at each read); this side
 * decides none and keeps only the keys the contract names. A field it cannot read throws a sentence naming its path,
 * and the lane keeps its last good picture.
 */

/** The ceiling on one document: a candidate carries at most about seven kilobytes of text, so this holds hundreds. */
export const RND_MAX_BUFFER = 4 * 1024 * 1024;

const DOCUMENT = 'dispatcher rnd show --json';

/** The exits on which a `dispatcher rnd` verb's first line is its refusal, in the roadmap verbs' form: 2 refused, 1 no such name. */
export const RND_REFUSAL_EXITS: readonly number[] = [1, 2];

export const RND_WORDS = ['waiting', 'spiking', 'proved', 'adopted', 'rejected'] as const;
export type RndWord = (typeof RND_WORDS)[number];
const VERDICT_WORDS = ['yes', 'no', 'unsettled'] as const;
const SCOUT_TRIGGERS = ['weekly', 'now'] as const;
const SCOUT_OUTCOMES = ['done', 'failed', 'lost'] as const;

export type RndSource = { url: string; label: string | null; added_at: string | null };
export type RndScoutOut = { id: number; launch: string | null; trigger: (typeof SCOUT_TRIGGERS)[number]; started_at: string };
export type RndScoutLast = RndScoutOut & {
  ended_at: string | null;
  outcome: (typeof SCOUT_OUTCOMES)[number] | null;
  filed: number;
};
export type RndCandidate = {
  name: string;
  title: string;
  what: string;
  why: string;
  question: string;
  source_url: string;
  source: string | null;
  word: RndWord;
  /** Never null: rnd_candidates.filed_at is NOT NULL, and the client's mark reads it on every page. */
  filed_at: string;
  filed_by: string | null;
  scout: number | null;
  spike: { session: string; started_at: string | null } | null;
  verdict: { word: (typeof VERDICT_WORDS)[number]; evidence: string | null; dir: string | null; at: string | null } | null;
  rejected: { why: string | null; at: string | null; by: string | null } | null;
  adopted: { plan: string; epic: string | null; at: string | null; word: string | null } | null;
};
export type RndPicture = {
  generated_at: string;
  settings: { web_search: boolean; weekly: string | null; sources: RndSource[] };
  scout: { out: RndScoutOut | null; last: RndScoutLast | null };
  standing: Record<RndWord, number>;
  candidates: RndCandidate[];
};
/** The lane's frame: the picture whole, under its kind, with the moment it was sent. */
export type RndStateEvent = { kind: 'rnd_state'; at: number } & RndPicture;

/** One `dispatcher rnd show --json`, read and checked. Throws a sentence naming the field or the failure. */
export async function readRndState(dependencies: DispatcherCommandDependencies): Promise<RndPicture> {
  return readPicture(await readDispatcherJson(['rnd', 'show', '--json'], dependencies, RND_MAX_BUFFER));
}

function readPicture(value: unknown): RndPicture {
  const document = record(value, 'the document');
  const settings = record(document['settings'], 'settings');
  const scout = record(document['scout'], 'scout');
  const standing = record(document['standing'], 'standing');
  return {
    generated_at: text(document['generated_at'], 'generated_at'),
    settings: {
      web_search: flag(settings['web_search'], 'settings.web_search'),
      weekly: textOrNull(settings['weekly'], 'settings.weekly'),
      sources: list(settings['sources'], 'settings.sources').map((source, at) => readSource(source, `settings.sources[${at}]`)),
    },
    scout: {
      out: orNull(scout['out'], 'scout.out', readScoutOut),
      last: orNull(scout['last'], 'scout.last', readScoutLast),
    },
    standing: {
      waiting: count(standing['waiting'], 'standing.waiting'),
      spiking: count(standing['spiking'], 'standing.spiking'),
      proved: count(standing['proved'], 'standing.proved'),
      adopted: count(standing['adopted'], 'standing.adopted'),
      rejected: count(standing['rejected'], 'standing.rejected'),
    },
    candidates: list(document['candidates'], 'candidates').map((candidate, at) => readRndCandidate(candidate, `candidates[${at}]`)),
  };
}

function readSource(value: unknown, path: string): RndSource {
  const source = record(value, path);
  return {
    url: text(source['url'], `${path}.url`),
    label: textOrNull(source['label'], `${path}.label`),
    added_at: textOrNull(source['added_at'], `${path}.added_at`),
  };
}

function readScoutOut(value: unknown, path: string): RndScoutOut {
  const scout = record(value, path);
  return {
    id: count(scout['id'], `${path}.id`),
    launch: textOrNull(scout['launch'], `${path}.launch`),
    trigger: oneOf(scout['trigger'], SCOUT_TRIGGERS, `${path}.trigger`),
    started_at: text(scout['started_at'], `${path}.started_at`),
  };
}

function readScoutLast(value: unknown, path: string): RndScoutLast {
  const scout = record(value, path);
  return {
    ...readScoutOut(value, path),
    ended_at: textOrNull(scout['ended_at'], `${path}.ended_at`),
    outcome: orNull(scout['outcome'], `${path}.outcome`, (word, at) => oneOf(word, SCOUT_OUTCOMES, at)),
    filed: count(scout['filed'], `${path}.filed`),
  };
}

/** One candidate as the document and `rnd show --json <name>` print it. Used by the spike route too. */
export function readRndCandidate(value: unknown, path: string): RndCandidate {
  const candidate = record(value, path);
  const at = (key: string): string => `${path}.${key}`;
  return {
    name: text(candidate['name'], at('name')),
    title: text(candidate['title'], at('title')),
    what: text(candidate['what'], at('what')),
    why: text(candidate['why'], at('why')),
    question: text(candidate['question'], at('question')),
    source_url: text(candidate['source_url'], at('source_url')),
    source: textOrNull(candidate['source'], at('source')),
    word: oneOf(candidate['word'], RND_WORDS, at('word')),
    filed_at: text(candidate['filed_at'], at('filed_at')),
    filed_by: textOrNull(candidate['filed_by'], at('filed_by')),
    scout: orNull(candidate['scout'], at('scout'), count),
    spike: orNull(candidate['spike'], at('spike'), (spike, where) => {
      const fields = record(spike, where);
      return { session: text(fields['session'], `${where}.session`), started_at: textOrNull(fields['started_at'], `${where}.started_at`) };
    }),
    verdict: orNull(candidate['verdict'], at('verdict'), (verdict, where) => {
      const fields = record(verdict, where);
      return {
        word: oneOf(fields['word'], VERDICT_WORDS, `${where}.word`),
        evidence: textOrNull(fields['evidence'], `${where}.evidence`),
        dir: textOrNull(fields['dir'], `${where}.dir`),
        at: textOrNull(fields['at'], `${where}.at`),
      };
    }),
    rejected: orNull(candidate['rejected'], at('rejected'), (rejected, where) => {
      const fields = record(rejected, where);
      return {
        why: textOrNull(fields['why'], `${where}.why`),
        at: textOrNull(fields['at'], `${where}.at`),
        by: textOrNull(fields['by'], `${where}.by`),
      };
    }),
    adopted: orNull(candidate['adopted'], at('adopted'), (adopted, where) => {
      const fields = record(adopted, where);
      return {
        plan: text(fields['plan'], `${where}.plan`),
        epic: textOrNull(fields['epic'], `${where}.epic`),
        at: textOrNull(fields['at'], `${where}.at`),
        word: textOrNull(fields['word'], `${where}.word`),
      };
    }),
  };
}

type Fields = Record<string, unknown>;

function refuse(path: string, expected: string): never {
  throw new Error(`${DOCUMENT}: ${path} is not ${expected}`);
}

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Fields {
  if (!isFields(value)) refuse(path, 'an object');
  return value;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) refuse(path, 'a list');
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') refuse(path, 'text');
  return value;
}

function textOrNull(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

function flag(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') refuse(path, 'true or false');
  return value;
}

function count(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) refuse(path, 'a whole count');
  return value;
}

function oneOf<T extends string>(value: unknown, words: readonly T[], path: string): T {
  const word = words.find((candidate) => candidate === value);
  if (word === undefined) refuse(path, `one of ${words.join(', ')}`);
  return word;
}

function orNull<T>(value: unknown, path: string, read: (value: unknown, path: string) => T): T | null {
  return value === null ? null : read(value, path);
}
