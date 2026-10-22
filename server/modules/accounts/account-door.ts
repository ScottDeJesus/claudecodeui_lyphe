import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ClaudeAccountCredential } from '@/shared/types.js';

import { DOOR_TIMEOUT_MS, doorBin, redact, writeDoor } from './account-door-relay.js';

/**
 * The house's account door, `~/.claude/scripts/claude-account`, and the ONE read a launch makes of
 * it: the account in use and its sign-in token, handed over a pipe this module opens.
 *
 * THE TOKEN TAKES THE PIPE, NOT THE ANSWER. `credential --fd N` writes the token to the descriptor
 * the caller named and puts only `{"account", "slug", "token": <bool>}` on stdout, so the token never
 * rides a stream an error, a log line or a body could pick up. This module reads that pipe to its end
 * and answers it to `claude-launch-account.ts`, whose only use for it is the environment of a Claude
 * CLI process. It is never in an answer this server gives, never in an error, never in a log line.
 *
 * A REAL FIFO, MADE HERE. The door refuses any descriptor that is not an open FIFO (`door.py`
 * `_is_open_pipe`, `stat.S_ISFIFO`), and Node's own `stdio: [..., 'pipe']` puts a SOCKETPAIR on an
 * extra descriptor — measured 2026-10-21, fd 3 was `0o140777`, and a launch against the real door
 * answered `exit 2` / `REFUSED: --fd must name a pipe the caller opened`. So this module makes a
 * FIFO with `mkfifo` in a private 0700 directory, opens the read end non-blocking, hands the child
 * the WRITE end as descriptor 3, and drops the parent's own copy the moment the child has it. The
 * read end is drained only after the child exits: a stream read on a NON-BLOCKING FIFO surfaces
 * EAGAIN as a fatal read error (measured 2026-10-21), while at the child's exit every byte it wrote
 * is already in the pipe's buffer, so one synchronous drain sees all of it and then end-of-file.
 * The directory goes when the answer does, whatever the answer is.
 *
 * A DOOR THAT CANNOT ANSWER IS NOT A FAULT: a missing verb, a non-zero exit, the 10 s bound, a body
 * that is not the shape above — every one answers all nulls, and the launch rides the live login as
 * it does today. That is what lets this land before any token is saved (the live box holds none).
 *
 * A SECOND SEAM. The door holds to "no token leaves" itself; this module blanks anything key-shaped
 * from the one string it could ever relay, the door's own stderr line.
 *
 * THE DOOR'S OTHER FACES — the panel's picture and the three writes that move the choice — are
 * `account-door-relay.ts`, and are re-exported here so a caller has one door to import.
 *
 * A SLUG RIDES AFTER `--`. The door is argparse, so a bare `use --help` answers the subparser's
 * usage text on stdout with exit 0 — a 200 for a write that never happened — and `--state` answers a
 * UsageError. The separator makes the slug a positional, so a slot named `-foo` (the door's own
 * `_slot_name` accepts one) is looked up as the name it is.
 */
export { AccountDoorRefusal, accountsPicture } from './account-door-relay.js';

/** The answer that rides the live login: no account, no token, no environment. */
const NOTHING: ClaudeAccountCredential = { account: null, slug: null, token: null };

/** One scratch FIFO: its directory, the parent's read end, and the child's write end. */
type TokenPipe = { dir: string; readFd: number; writeFd: number };

/**
 * A fresh FIFO under a 0700 directory of its own, or null when the filesystem will not give one.
 * The read end is opened first and NON-BLOCKING: opening a FIFO read-only otherwise waits for a
 * writer, and opening the write end waits for a reader — one of the two must not block.
 */
function tokenPipe(): TokenPipe | null {
  let dir: string | null = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-account-'));
    const fifo = path.join(dir, 'token');
    execFileSync('mkfifo', ['-m', '600', fifo], { stdio: 'ignore' });
    const readFd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    try {
      const writeFd = fs.openSync(fifo, fs.constants.O_WRONLY);
      return { dir, readFd, writeFd };
    } catch (error) {
      fs.closeSync(readFd);
      throw error;
    }
  } catch {
    if (dir !== null) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // A scratch FIFO left behind is not a fault; the launch's answer is the one thing that matters.
      }
    }
    return null;
  }
}

/** The parsed credential line's fields, or `NOTHING` when it is not the line the door promises. */
function credentialOf(stdout: string, token: string): ClaudeAccountCredential {
  const line = stdout.trim().split('\n').at(-1) ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return NOTHING;
  }
  if (typeof parsed !== 'object' || parsed === null) return NOTHING;
  const answer = parsed as { account?: unknown; slug?: unknown; token?: unknown };
  if (answer.account !== null && typeof answer.account !== 'string') return NOTHING;
  if (answer.slug !== null && typeof answer.slug !== 'string') return NOTHING;
  if (typeof answer.token !== 'boolean') return NOTHING;
  const account = typeof answer.account === 'string' && answer.account !== '' ? answer.account : null;
  const slug = typeof answer.slug === 'string' && answer.slug !== '' ? answer.slug : null;
  return { account, slug, token: answer.token ? token.trim() || null : null };
}

/**
 * Every byte waiting on `fd`, read synchronously after the writer has exited. A non-blocking FIFO
 * with no writer left answers 0 (end of file); one whose writer somehow survives answers EAGAIN,
 * which ends the drain rather than blocking a launch thread on it.
 */
function drainPipe(fd: number): string {
  let text = '';
  const buffer = Buffer.alloc(4096);
  for (;;) {
    let read: number;
    try {
      read = fs.readSync(fd, buffer, 0, buffer.length, null);
    } catch {
      return text;
    }
    if (read === 0) return text;
    text += buffer.toString('utf8', 0, read);
  }
}

/**
 * The account in use and its token, read through the door's credential verb.
 *
 * The child gets three descriptors of its own plus the FIFO's write end at 3; stdout carries the one
 * JSON line. Any failure answers all nulls. The only string that can reach a log line is the door's
 * stderr, redacted; stdout is parsed and never printed, because a stand-in door could echo the token.
 */
export function launchCredential(): Promise<ClaudeAccountCredential> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child: ChildProcess | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pipe = tokenPipe();
    if (pipe === null) {
      resolve(NOTHING);
      return;
    }

    const finish = (answer: ClaudeAccountCredential): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        fs.closeSync(pipe.readFd);
      } catch {
        // Already closed is the same as closed.
      }
      try {
        fs.rmSync(pipe.dir, { recursive: true, force: true });
      } catch {
        // Same rule as the FIFO's creation: a scratch path left behind is never a launch's answer.
      }
      resolve(answer);
    };

    try {
      child = spawn(doorBin(), ['credential', '--fd', '3'], {
        // 3 is the FIFO's write end. The parent's copy is dropped below, so the door is the only
        // writer and its exit is the only end of the pipe there can be.
        stdio: ['ignore', 'pipe', 'pipe', pipe.writeFd],
      });
    } catch {
      // A spawn that throws synchronously (a malformed option) is the same "door did not answer".
      finish(NOTHING);
      return;
    } finally {
      try {
        fs.closeSync(pipe.writeFd);
      } catch {
        // Already closed is the same as closed.
      }
    }
    timer = setTimeout(() => {
      child?.kill('SIGKILL');
      finish(NOTHING);
    }, DOOR_TIMEOUT_MS);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });

    child.on('error', () => finish(NOTHING));
    child.on('close', (code) => {
      // The door has exited, so every byte it wrote to the pipe is in the buffer: drain once.
      const token = drainPipe(pipe.readFd);
      if (settled) return;
      if (code !== 0) {
        const said = redact(stderr.trim());
        console.warn(`[claude-account] credential: ${said || `exit ${code ?? 'signal'}`}`);
        finish(NOTHING);
        return;
      }
      finish(credentialOf(stdout, token));
    });
  });
}

/**
 * `claude-account use <slug>` — choose the account new chats and plan runs start on. Used by
 * `accounts.routes.ts` (`POST /api/accounts/use`). The door refuses an account with no checked token
 * (422) and answers `USING <slug>`, with its held sentence when the account is full now. It kicks
 * the dispatcher itself (INV-187).
 */
export function useAccount(slug: string): Promise<string> {
  return writeDoor(['use', '--', slug]);
}

/**
 * `claude-account auto on|off` — the switch-automatically setting, used by `accounts.routes.ts`
 * (`POST /api/accounts/auto`); answers `AUTO on` or `AUTO off`.
 */
export function setAuto(on: boolean): Promise<string> {
  return writeDoor(['auto', on ? 'on' : 'off']);
}

/**
 * `claude-account remove <slug>` — drop the account and its token, used by `accounts.routes.ts`
 * (`POST /api/accounts/remove`). A chosen account is unchosen and the dispatcher kicked by the door
 * itself (INV-187); answers `REMOVED <slug>`.
 */
export function removeAccount(slug: string): Promise<string> {
  return writeDoor(['remove', '--', slug]);
}
