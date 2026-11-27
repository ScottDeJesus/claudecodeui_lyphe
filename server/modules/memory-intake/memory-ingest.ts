import { spawn } from 'node:child_process';
import fs from 'node:fs';

/**
 * The approval's start of the inbox run — the trigger that takes a filed memory note into the store.
 *
 * The approval only files the note (INV-133); the docstore inbox run is the one writer of its row and
 * deletes the note last (INV-193). This module starts that run the moment the approval has committed,
 * so a note does not sit until the nightly backstop. The run takes its own lock and waits for a run
 * already under way, so two approvals in one second are two runs in turn, never one note twice.
 *
 * FAIL-OPEN (INV-1): nothing here throws or is awaited. A spawn that cannot start is one more line in
 * the inbox log, and the approval's answer is the same either way.
 */

/** The docstore door whose `ingest --inbox` is the inbox run, and the log every trigger of it shares. */
const DOCSTORE_DOOR = '/home/lyphe/.claude/scripts/docstore';
const INBOX_LOG = '/home/lyphe/.claude/state/docstore/inbox.log';

/** Log the approval, then start one detached inbox run whose output lands in the same log. */
export function ingestInboxSoon(notePath: string | null): void {
  logLine(`memory approval fired ${notePath}`);

  let out: number | null = null;
  try {
    out = fs.openSync(INBOX_LOG, 'a');
    const child = spawn(DOCSTORE_DOOR, ['ingest', '--inbox'], {
      detached: true,
      stdio: ['ignore', out, out],
      cwd: '/',
    });
    child.on('error', (error) => logLine(`memory approval could not start the inbox run: ${error.message}`));
    child.unref();
  } catch (error) {
    logLine(`memory approval could not start the inbox run: ${messageOf(error)}`);
  } finally {
    // The child holds its own copy of the descriptor; this process's copy is not needed past the spawn.
    if (out !== null) closeQuietly(out);
  }
}

function logLine(words: string): void {
  try {
    fs.appendFileSync(INBOX_LOG, `${new Date().toISOString()} ${words}\n`);
  } catch (error) {
    console.warn(`[memory-ingest] cannot append to ${INBOX_LOG} (${words}): ${messageOf(error)}`);
  }
}

function closeQuietly(descriptor: number): void {
  try {
    fs.closeSync(descriptor);
  } catch (error) {
    console.warn(`[memory-ingest] cannot close the inbox log descriptor: ${messageOf(error)}`);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
