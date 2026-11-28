/**
 * The door to the transcript engine (rust/transcript-engine/): the only code that runs its binary.
 * Callers hand it absolute paths; the engine knows no directory. Refusals are AppErrors with status
 * 503: TRANSCRIPT_ENGINE_UNAVAILABLE (no binary), TRANSCRIPT_ENGINE_STALE (another protocol) and
 * TRANSCRIPT_ENGINE_FAILED (a non-zero exit or a signal the door did not send; the last stderr line).
 */
import type { AnyRecord } from '@/shared/types.js';

import { isRecord, learnEngineVersion, openEngineRun, protocolFailure, type EngineRun } from './engine-process.js';
import { onEngineRecovered } from './engine-status.js';
import type {
  TitleRowsResult,
  TranscriptEngineVerb,
  TranscriptSearchFileRecord,
  TranscriptSearchJob,
  TranscriptSearchMatch,
  TranscriptSearchRun,
} from './transcript-engine.types.js';

export { TRANSCRIPT_ENGINE_PROTOCOL } from './engine-process.js';
export { transcriptEngineStatus } from './engine-status.js';
export type {
  TitleRowsResult,
  TranscriptEngineStatus,
  TranscriptSearchFileRecord,
  TranscriptSearchJob,
  TranscriptSearchMatch,
  TranscriptSearchRun,
} from './transcript-engine.types.js';

onEngineRecovered(() => {
  void learnEngineVersion();
});
// Never awaited: the boot does not wait on the engine, and a missing one only shows in /health and in its own calls' refusals.
void learnEngineVersion();

/** Every assistant row of one transcript whose message carries usage, in file order, reduced to type, isSidechain, message.id and message.usage. */
export async function readClaudeUsageRows(filePath: string): Promise<AnyRecord[]> {
  const run = openEngineRun('usage', { args: [filePath] });
  const rows: AnyRecord[] = [];
  for (let row = await run.next(); row !== null; row = await run.next()) {
    rows.push(row);
  }
  return rows;
}

/** Each file's custom-title, ai-title and last-prompt rows, verbatim and in file order; index-aligned with `filePaths`. */
export async function readTitleRows(filePaths: string[]): Promise<TitleRowsResult[]> {
  if (filePaths.length === 0) {
    return [];
  }
  const run = openEngineRun('titles', { input: { files: filePaths } });
  try {
    const results: TitleRowsResult[] = [];
    for (let index = 0; index < filePaths.length; index += 1) {
      results.push(titleResultOf(await recordAt(run, 'titles', index)));
    }
    const extra = await run.next();
    if (extra !== null) {
      throw protocolFailure('titles', `it wrote more than the ${filePaths.length} records asked for`);
    }
    return results;
  } finally {
    run.end();
  }
}

/** Starts one search over the job's files; each file's record is read when asked for. */
export function openTranscriptSearch(job: TranscriptSearchJob, options: { signal?: AbortSignal } = {}): TranscriptSearchRun {
  const run = openEngineRun('search', { input: job, signal: options.signal });
  let nextUnreadIndex = 0;
  // forFile reads several records per call; chaining the calls keeps a later one from taking an earlier one's record.
  let previous: Promise<unknown> = Promise.resolve();

  const readThrough = async (index: number): Promise<TranscriptSearchFileRecord> => {
    if (index < nextUnreadIndex) {
      throw new Error(`forFile(${index}) was asked after file ${nextUnreadIndex - 1}: indexes must rise.`);
    }
    for (;;) {
      const record = searchRecordOf(await recordAt(run, 'search', null));
      nextUnreadIndex = record.i + 1;
      if (record.i === index) {
        return record;
      }
      if (record.i > index) {
        throw protocolFailure('search', `it wrote file ${record.i} where file ${index} was due`);
      }
    }
  };

  return {
    forFile(index) {
      const answer = previous.then(() => readThrough(index));
      // The chain only orders the calls; each call's own failure reaches its caller through `answer`.
      previous = answer.catch(() => undefined);
      return answer;
    },
    end: run.end,
  };
}

async function recordAt(run: EngineRun, verb: TranscriptEngineVerb, index: number | null): Promise<Record<string, unknown>> {
  const record = await run.next();
  if (record === null) {
    throw protocolFailure(verb, `it ended before the record of file ${index ?? 'asked for'}`);
  }
  if (typeof record.i !== 'number' || !Number.isInteger(record.i) || (index !== null && record.i !== index)) {
    throw protocolFailure(verb, `a record carries i=${JSON.stringify(record.i)} where ${index ?? 'a file index'} was due`);
  }
  return record;
}

function titleResultOf(record: Record<string, unknown>): TitleRowsResult {
  if (typeof record.error === 'string') {
    return { error: record.error };
  }
  const rows = record.rows;
  if (!Array.isArray(rows) || !rows.every(isRecord)) {
    throw protocolFailure('titles', `the record of file ${String(record.i)} has no rows`);
  }
  return { rows };
}

function searchRecordOf(record: Record<string, unknown>): TranscriptSearchFileRecord {
  const i = Number(record.i);
  if (typeof record.error === 'string') {
    return { i, error: record.error };
  }
  if (record.matches === undefined && record.summaries === undefined) {
    return { i };
  }
  const summaries = record.summaries;
  const matches = Array.isArray(record.matches) ? record.matches.map(searchMatchOf) : null;
  if (!isRecord(summaries) || matches === null || matches.some((match) => match === null)) {
    throw protocolFailure('search', `the record of file ${i} has malformed matches or summaries`);
  }
  const summaryTexts: Record<string, string | null> = {};
  for (const [session, summary] of Object.entries(summaries)) {
    summaryTexts[session] = typeof summary === 'string' ? summary : null;
  }
  return { i, summaries: summaryTexts, matches: matches.filter((match): match is TranscriptSearchMatch => match !== null) };
}

function searchMatchOf(value: unknown): TranscriptSearchMatch | null {
  if (!isRecord(value)) {
    return null;
  }
  const { session, role, text, timestamp, uuid } = value;
  if (typeof session !== 'string' || typeof text !== 'string' || (role !== 'user' && role !== 'assistant')) {
    return null;
  }
  return {
    session,
    role,
    text,
    timestamp: typeof timestamp === 'string' ? timestamp : null,
    uuid: typeof uuid === 'string' ? uuid : null,
  };
}
