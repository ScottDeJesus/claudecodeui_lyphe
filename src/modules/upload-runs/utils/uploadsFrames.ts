import type { UploadRunEvent, UploadRunsFrame } from '@/shared/upload-runs-types';

/*
 * THE TWO STREAMS' EDGE: what an `EventSource` hands over is text, and a frame or a bubble is trusted only after it has
 * been read here into the wire type. A body that is not what the engine writes is skipped with a line in the console that
 * says which stream and why, never half-drawn: a view that throws while it draws takes the whole workspace's main region
 * with it (the workspace's boundary), so the check is made once, where the text enters.
 */

type RunEdge = Extract<UploadRunsFrame, { type: 'run' }>['edge'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isRunEdge = (value: unknown): value is RunEdge => value === 'opened' || value === 'state' || value === 'ended';

const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';

function parseJson(stream: 'feed' | 'run stream', data: unknown): unknown {
  if (typeof data !== 'string') return null;
  try {
    return JSON.parse(data);
  } catch (failure) {
    console.warn(`The upload runs ${stream} sent something that is not JSON; it was skipped.`, failure);
    return null;
  }
}

/** One feed frame, or null for text that is not a frame of the feed's two kinds (`run` and `walk`). */
export function parseFrame(data: unknown): UploadRunsFrame | null {
  const body = parseJson('feed', data);
  if (!isRecord(body) || typeof body.session_id !== 'string' || typeof body.at !== 'string') return null;
  if (body.type === 'run' && typeof body.state === 'string' && isRunEdge(body.edge)) {
    return { type: 'run', session_id: body.session_id, edge: body.edge, state: body.state, at: body.at };
  }
  if (body.type === 'walk' && typeof body.walk_id === 'string' && isTextOrNull(body.step_cursor) && isTextOrNull(body.outcome)) {
    return { type: 'walk', session_id: body.session_id, walk_id: body.walk_id, step_cursor: body.step_cursor, outcome: body.outcome, at: body.at };
  }
  console.warn('The upload runs feed sent a frame this build has no shape for; it was skipped.', body.type);
  return null;
}

/** A tool call or result as the bubble carries it, or undefined where the bubble named none that can be read. */
function parseTool(value: unknown): UploadRunEvent['tool'] {
  if (!isRecord(value) || typeof value.summary !== 'string') return undefined;
  const { id, name, ok } = value;
  return {
    id: typeof id === 'string' ? id : null,
    name: typeof name === 'string' ? name : null,
    summary: value.summary,
    ok: typeof ok === 'boolean' ? ok : null,
  };
}

/**
 * One bubble of a run's stream, or null for text that is not one. Only the keys the registry stamps on every bubble are
 * required; `text`, `tool`, `meta` and `truncated` are carried when they are there and in the shape the wire type says.
 */
export function parseBubble(data: unknown): UploadRunEvent | null {
  const body = parseJson('run stream', data);
  if (!isRecord(body)) return null;
  const { seq, ts, kind, role } = body;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return null;
  if (typeof ts !== 'string' || typeof kind !== 'string' || typeof role !== 'string') return null;
  const event: UploadRunEvent = { seq, ts, kind, role };
  if (typeof body.text === 'string') event.text = body.text;
  if (body.truncated === true) event.truncated = true;
  const tool = parseTool(body.tool);
  if (tool !== undefined) event.tool = tool;
  if (isRecord(body.meta)) event.meta = body.meta;
  return event;
}
