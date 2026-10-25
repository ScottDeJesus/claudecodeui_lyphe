import { existsSync, lstatSync, mkdirSync, readlinkSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import type { Stats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

/**
 * Keeps `~/.local/bin/<name>` a symlink to this checkout's `bin/<name>.mjs`, so the command a chat's
 * pointer or skill names (`toolset on <name>`, `notes list`) is on the box's PATH without a hand step
 * to link it (that the directory is on a chat's PATH is the operator's own, below). A command's code
 * lives in this repo because its contract is this server's routes and environment, and the server
 * keeps the link for the same reason.
 *
 * Three rules, the whole of its character:
 *
 * 1. **Right means silent.** A link that already points at the target writes nothing, so the boots
 *    and handovers that follow the first leave no line. Every other outcome writes exactly one.
 * 2. **A regular file is the operator's.** Something that is not a symlink under that name is a
 *    command he put there; it is left alone with one warning, never replaced.
 * 3. **Created and re-pointed without a gap.** Two servers run side by side during a handover, and a
 *    chat's Bash may call the command at any moment, so a re-point makes the new symlink under a
 *    scratch name in the SAME directory and renames it over the old one (an atomic replace); a
 *    create that loses the race to the other server (`EEXIST`) got the outcome it wanted.
 *
 * `~/.local/bin` reaches a chat's Bash tool through the operator's `~/.claude/settings.json`
 * `env.PATH`, which names it (and `~/.claude/scripts`), NOT through the dev unit's
 * `Environment=PATH=` (which lacks it) and not through `~/.profile`. The CLI applies that `env` at
 * run time, so neither the API's nor the CLI process's own `/proc/<pid>/environ` shows it, while the
 * Bash tool's PATH (and the shell snapshots from 2026-10-05 on; the oldest, of mid-September, lack
 * the directory) carry exactly that string. A box whose settings.json lacks the directory has the
 * command as "command not found" in a chat.
 *
 * `commandName` is the file's stem under `bin/` and the name it is linked as; `logLabel` is the
 * bracketed word its lines carry. Consumed by `toolsets.module.ts`, `notes.module.ts` and `followups.module.ts`,
 * each of which calls it once at creation and wraps it, so a link that cannot be made is one warning and the
 * API stays up.
 */
export function ensureChatCommandLink(commandName: string, logLabel: string): void {
  const target = path.join(findApplicationRoot(getModuleDirectory(import.meta.url)), 'bin', `${commandName}.mjs`);
  const linkDirectory = path.join(os.homedir(), '.local', 'bin');
  const linkPath = path.join(linkDirectory, commandName);

  // A link to a file that is not there is worse than no link: the command would fail with a node
  // stack instead of the "command not found" a skill's fallback already handles.
  if (!existsSync(target)) {
    console.warn(`[${logLabel}] the ${commandName} command is missing from this install (${target}); ${linkPath} is left as it is`);
    return;
  }

  mkdirSync(linkDirectory, { recursive: true });

  let existing: Stats | null = null;
  try {
    existing = lstatSync(linkPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (existing === null) {
    try {
      symlinkSync(target, linkPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
      throw error;
    }
    console.log(`[${logLabel}] linked ${linkPath} -> ${target}`);
    return;
  }

  if (!existing.isSymbolicLink()) {
    console.warn(`[${logLabel}] ${linkPath} is a regular file, not a link to ${target}; it is left alone`);
    return;
  }

  const previousTarget = readlinkSync(linkPath);
  if (previousTarget === target) return;

  const scratchPath = `${linkPath}.${process.pid}.tmp`;
  try {
    symlinkSync(target, scratchPath);
    renameSync(scratchPath, linkPath);
  } catch (error) {
    // The scratch name is the one this call just made (or failed to); unlinking it is not a guess.
    try {
      unlinkSync(scratchPath);
    } catch {
      // Nothing to clean: the symlink was never made.
    }
    throw error;
  }
  console.log(`[${logLabel}] re-pointed ${linkPath} from ${previousTarget} to ${target}`);
}
