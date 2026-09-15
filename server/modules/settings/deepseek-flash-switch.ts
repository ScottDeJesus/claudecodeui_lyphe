import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * The plan runner's DeepSeek switch, as a file.
 *
 * The runner reads this exact path at every spawn that decides a phase
 * (`~/.claude/hooks/plan_runner/deepseek.py`), so a flip here takes effect on the next builder
 * with nothing restarted on either side. It is deliberately not a row in `auth.db`: the runner is
 * a separate daemon that must be able to read the switch from cron, with no database and no HTTP.
 */
const SWITCH_PATH = path.join(os.homedir(), '.claude', 'state', 'deepseek_flash.flag');

/**
 * The runner's own bound on the file (`state._FLAG_MAX_BYTES`). Kept identical so both readers
 * answer the same question: a file past this is OFF here exactly as it is there, rather than
 * being truncated to a prefix that could read `on` when the whole file does not.
 */
const SWITCH_MAX_BYTES = 256;

/**
 * The trim `String.trim()` does not do, added so this reader and the runner's agree.
 *
 * Both files claimed to hold one predicate and did not. `trim()` and Python's `str.strip()` are
 * different sets, measured diverging in both directions: `strip()` drops the C0 separators
 * ``–``, which `trim()` keeps (closed here); `trim()` drops the UTF-8 BOM, which
 * `strip()` keeps (closed there, by reading the file as `utf-8-sig`). A BOM was the reachable
 * half — a flag saved by a Windows editor or PowerShell `Out-File` carries one, and this reader
 * then said ON while the runner went on spending Claude. `\s` already covers the BOM, every
 * ASCII space and NBSP, all of which the two sides already agreed on.
 */
const SWITCH_TRIM = /^[\s-]+|[\s-]+$/g;

/** Reads ON, in the runner's own predicate: present, small, and trimmed content exactly `on`. */
export async function readDeepseekFlashSwitch(): Promise<boolean> {
  try {
    if ((await stat(SWITCH_PATH)).size > SWITCH_MAX_BYTES) return false;
    return (await readFile(SWITCH_PATH, 'utf8')).replace(SWITCH_TRIM, '') === 'on';
  } catch {
    return false;                 // absent or unreadable is OFF, never an error to the caller
  }
}

/**
 * Writes the switch, through a scratch file and a rename.
 *
 * The runner reads this file from another process while this one writes it, and a plain
 * `writeFile` is a truncate followed by a write — a reader landing between the two sees an empty
 * file. That reads OFF, which is the safe answer, but it would be a phantom flip in the log of a
 * run that nobody flipped anything on. `rename` inside one directory is atomic, so a reader sees
 * only the old content or the new.
 *
 * The scratch name carries a UUID, not just the pid. `writeFile` yields, so two concurrent PUTs in
 * ONE node process interleaved on a single per-process scratch path: A wrote it, B wrote it, A
 * renamed it away, and B's rename found nothing — measured, 4 of 20 concurrent PUTs returned 500
 * ENOENT. The rename was atomic with respect to its destination; it was the SOURCE that had to be
 * unique. The switch is documented as host-wide, so two tabs or two operators is the stated
 * design, not an exotic case.
 *
 * The destination is resolved through any symlink first: `rename` onto a symlink REPLACES the link
 * with a regular file, so a flag the operator had symlinked elsewhere silently stopped being
 * shared after the first toggle. And a scratch file outlives a failed rename unless something
 * removes it, so the `finally` does.
 */
export async function writeDeepseekFlashSwitch(enabled: boolean): Promise<void> {
  await mkdir(path.dirname(SWITCH_PATH), { recursive: true });
  // `realpath` throws when the flag does not exist yet, which is not an error: there is no link to
  // follow, and the literal path is the right destination.
  const destination = await realpath(SWITCH_PATH).catch(() => SWITCH_PATH);
  const scratch = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(scratch, enabled ? 'on\n' : 'off\n', 'utf8');
    await rename(scratch, destination);
  } finally {
    // Only still in place when the rename failed; a successful rename moved it, and that ENOENT
    // is swallowed.
    await unlink(scratch).catch(() => undefined);
  }
}
