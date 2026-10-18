// @ts-check
/**
 * The CLI's background tasks a host's journal shows running — what the runtime's live loop calls `backgroundTasks`.
 *
 * A restart forgets that set: the frames that built it went to the API process that died, and the host replays
 * only the ones that process never acknowledged. Every kind of task the CLI lists — a backgrounded subagent, a
 * monitor, a shell job — then reads idle until its next change, which is the moment a compaction, the idle
 * closer or the version sweep would end the process under work that is still running. The journal has every
 * frame the CLI wrote, so the set is rebuilt from it, by the reducer the live loop uses: the CLI's own
 * `background_tasks_changed` REPLACES the set, `task_started` adds an id, `task_notification` removes one.
 * A `task_started` with no `task_notification` after it is a live task.
 *
 * Plain JavaScript on node builtins alone, like `host-registry.js` (its one consumer), which a warden runs too.
 *
 * consumer: host-registry.js (`listLiveHosts`)
 */

import fs from 'node:fs';

// A journal entry's CLI line is an escaped string, so a task frame's subtype shows as `\"subtype\":\"task_started\"`.
const TASK_FRAME = /\\"subtype\\":\\"(task_started|task_notification|background_tasks_changed)\\"/;

/** @typedef {{ kind: 'replace', ids: string[] } | { kind: 'start' | 'end', id: string }} TaskFrame */

/**
 * What one journal entry says about the CLI's background tasks, or null when it says nothing.
 * @param {string} raw
 * @returns {TaskFrame | null}
 */
function readTaskFrame(raw) {
  if (!raw.includes('"t":"out"') || !TASK_FRAME.test(raw)) return null;
  try {
    const entry = JSON.parse(raw);
    if (entry.t !== 'out' || typeof entry.line !== 'string') return null;
    const output = JSON.parse(entry.line);
    if (output.type !== 'system') return null;
    if (output.subtype === 'background_tasks_changed') {
      if (!Array.isArray(output.tasks)) return null;
      /** @type {string[]} */
      const ids = [];
      for (const task of output.tasks) {
        if (typeof task?.task_id === 'string') ids.push(task.task_id);
      }
      return { kind: 'replace', ids };
    }
    if (typeof output.task_id !== 'string') return null;
    if (output.subtype === 'task_started') return { kind: 'start', id: output.task_id };
    if (output.subtype === 'task_notification') return { kind: 'end', id: output.task_id };
    return null;
  } catch {
    return null;
  }
}

/**
 * `ids` after one task frame, moved the way the live loop moves its own set.
 * @param {Set<string>} ids
 * @param {TaskFrame} frame
 */
function applyTaskFrame(ids, frame) {
  if (frame.kind === 'replace') {
    ids.clear();
    for (const id of frame.ids) ids.add(id);
  } else if (frame.kind === 'start') {
    ids.add(frame.id);
  } else {
    ids.delete(frame.id);
  }
}

/**
 * One reader over one registry's journals.
 * @param {object} config
 * @param {(hostId: string) => string} config.hostJournalPath
 * @param {(hostId: string, visit: (raw: string) => boolean) => boolean} config.journalLineNewestFirst The registry's walk, newest line first.
 */
export function createLiveTaskReader({ hostJournalPath, journalLineNewestFirst }) {
  /**
   * The answers by host: the set as of the journal's `offset` (the end of the last whole line read), so a poll of a
   * host whose journal has grown reads only what was appended, and a quiet host costs one `stat`.
   * @type {Map<string, { offset: number, ids: Set<string> }>}
   */
  const memo = new Map();

  /**
   * The whole lines of the journal in `[from, to)`: the text up to and including the last newline, and how many bytes
   * that is. A line still being appended is left for the next read.
   * @param {string} hostId
   * @param {number} from
   * @param {number} to
   * @returns {{ text: string, bytes: number }}
   */
  function readWholeLinesFrom(hostId, from, to) {
    let fd;
    try {
      fd = fs.openSync(hostJournalPath(hostId), 'r');
    } catch {
      return { text: '', bytes: 0 };
    }
    try {
      const buffer = Buffer.alloc(to - from);
      const read = fs.readSync(fd, buffer, 0, buffer.length, from);
      const lastNewline = buffer.subarray(0, read).lastIndexOf(0x0a);
      if (lastNewline === -1) return { text: '', bytes: 0 };
      return { text: buffer.toString('utf8', 0, lastNewline + 1), bytes: lastNewline + 1 };
    } finally {
      fs.closeSync(fd);
    }
  }

  return {
    /**
     * The ids of the tasks the host's journal shows running. The first read walks the journal newest first and stops at
     * the newest `background_tasks_changed` (the base), then applies the task frames after it; later reads apply only
     * what was appended.
     * @param {string} hostId
     * @returns {string[]}
     */
    liveTasks(hostId) {
      let size;
      try {
        size = fs.statSync(hostJournalPath(hostId)).size;
      } catch {
        return [];
      }
      const held = memo.get(hostId);
      if (held && held.offset === size) return [...held.ids];
      if (held && held.offset < size) {
        const appended = readWholeLinesFrom(hostId, held.offset, size);
        for (const raw of appended.text.split('\n')) {
          const frame = readTaskFrame(raw);
          if (frame) applyTaskFrame(held.ids, frame);
        }
        held.offset += appended.bytes;
        return [...held.ids];
      }
      let ids = new Set();
      /** @type {TaskFrame[]} */
      const newer = [];
      journalLineNewestFirst(hostId, (raw) => {
        const frame = readTaskFrame(raw);
        if (frame === null) return false;
        if (frame.kind === 'replace') {
          ids = new Set(frame.ids);
          return true;
        }
        newer.push(frame);
        return false;
      });
      for (let index = newer.length - 1; index >= 0; index -= 1) applyTaskFrame(ids, newer[index]);
      memo.set(hostId, { offset: size, ids });
      return [...ids];
    },

    /**
     * Forgets a host whose journal is gone.
     * @param {string} hostId
     */
    forget(hostId) {
      memo.delete(hostId);
    }
  };
}
