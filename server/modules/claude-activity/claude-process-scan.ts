/**
 * The process scan: which `claude` CLIs are alive on this machine, whoever started them.
 *
 * It exists because the run registry and the session-host metas only know the work THIS server
 * started. A dispatch soul, a plan-runner chain, a shell tab's interactive session and a Metis child
 * are all `claude` processes the server never registered as a turn, and an update that installs under
 * any of them is an update that installs under a conversation.
 *
 * WHICH PROCESSES COUNT is decided by argv[0]'s basename — `claude`, or `claude.exe` when the package's
 * own file was exec'd by its real name — never by the kernel's process name alone and never by a
 * substring of the command line. The CLI re-execs its own binary for its bundled search tools with
 * argv[0] rewritten (`ugrep …`), and an orphan of one of those is not a session: counting it would
 * hold every update back for as long as the orphan lives.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';

/** How long `ps` may take. It answers in milliseconds on a healthy box; a longer wait is a box that is
 *  not answering, which the caller reads as "cannot tell" and never as "nothing is running". */
const PS_TIMEOUT_MS = 5_000;

/** `ps` prints every process's full command line, and a Claude CLI's can carry a long system prompt. */
const PS_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** The two names the CLI's executable goes by: the npm `bin` symlink and the package's own file. */
const CLAUDE_EXECUTABLE_NAMES: ReadonlySet<string> = new Set(['claude', 'claude.exe']);

/**
 * The pid of every live `claude` CLI process on this machine.
 *
 * REJECTS when `ps` cannot answer — it is not started, times out or exits non-zero. An empty array
 * means the scan ran and found nothing; it never means the scan failed. Every caller that gates an
 * action on the answer must treat a rejection as busy.
 *
 * consumer: claude-activity.service.ts, for the "other Claude processes" leg of the activity reading.
 */
export function listClaudeProcessIds(): Promise<number[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'ps',
      // `=` after each column drops the header line, so every line of the output is a process.
      ['-eo', 'pid=,args='],
      { timeout: PS_TIMEOUT_MS, maxBuffer: PS_MAX_BUFFER_BYTES, encoding: 'utf8' },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        const pids: number[] = [];
        for (const line of stdout.split('\n')) {
          const match = /^\s*(\d+)\s+(\S+)/.exec(line);
          if (match === null) continue;
          if (CLAUDE_EXECUTABLE_NAMES.has(path.basename(match[2]))) pids.push(Number(match[1]));
        }
        resolve(pids);
      },
    );
  });
}
