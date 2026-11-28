/**
 * The shapes of the transcript engine's verbs, as its door hands them to callers. The engine's side
 * of each record is written in rust/transcript-engine/src/; a change to either side changes
 * TRANSCRIPT_ENGINE_PROTOCOL (engine-process.ts) and PROTOCOL (main.rs) together.
 */
import type { AnyRecord } from '@/shared/types.js';

export type TranscriptEngineVerb = 'usage' | 'titles' | 'search';

/** The last known state of the engine, as `/health` reports it. */
export type TranscriptEngineStatus = {
  ok: boolean;
  version: string | null;
  protocol: number | null;
  error: string | null;
};

/** One file's answer to `titles`: its custom-title, ai-title and last-prompt rows, or why it could not be read. */
export type TitleRowsResult = { rows: AnyRecord[] } | { error: string };

/** The job `search` reads from stdin. `transparentWrappers` is the caller's TRANSPARENT_WRAPPER_COMMANDS. */
export type TranscriptSearchJob = {
  words: string[];
  maxPerSession: number;
  transparentWrappers: string[];
  files: Array<{ path: string; sessions: string[] }>;
};

export type TranscriptSearchMatch = {
  session: string;
  role: 'user' | 'assistant';
  /** The row's whole visible text. */
  text: string;
  timestamp: string | null;
  uuid: string | null;
};

/**
 * One file's answer to `search`: `{ i }` when the gate refused it or no row is a hit, `error` when it
 * could not be read, else its matches in line order (at most maxPerSession per session) and one
 * summary for each session that has a match.
 */
export type TranscriptSearchFileRecord =
  | { i: number }
  | { i: number; error: string }
  | { i: number; summaries: Record<string, string | null>; matches: TranscriptSearchMatch[] };

export type TranscriptSearchRun = {
  /** Asked with rising indexes; reads the engine's output only as far as the record asked for. */
  forFile(index: number): Promise<TranscriptSearchFileRecord>;
  /** Sends SIGTERM; safe to call twice; what the signal's abort calls. */
  end(): void;
};
