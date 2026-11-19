import { firstLine, runDispatcherCommand, type CommandDependencies, type DispatcherCommandResult } from '@/modules/dispatcher/index.js';
import { sessionlessEnv } from '@/shared/child-env.js';
import { dispatcherBin } from '@/shared/dispatcher-command.js';

/**
 * The ticket door: how a server module that DETECTS a defect (today Cerberus's red watch) files it on the house's
 * bug line and says it is gone. Each call is one `dispatcher bug file` or `dispatcher bug cleared`, the words on
 * stdin, run with the lane's own composition: the dispatcher's entry point, and `sessionlessEnv()` so no session id
 * rides along (a machine is nobody's chat). The house decides everything: which folder a service names
 * (`charters/bugs.toml`), whether an open ticket already holds the key (`ALREADY FILED`), and whether a cleared one
 * is reopened. This file only spawns and carries back the dispatcher's first line, so the caller logs one line.
 * It never throws and never opens a file of the dispatcher's.
 *
 * Consumer: `modules/cerberus/red-watch-tickets.ts`, through this module's barrel.
 */

/** A filing is one store write and a clearing one more; anything near this is a hang. */
const TICKET_TIMEOUT_MS = 20_000;

/** How much of a traceback's last line the answer carries: the same cut `firstLine` gives a stdout line. */
const ANSWER_LINE_CHARS = 200;

/** The machines that file through this door; a chat or a soul files from its own shell with `~/.claude/scripts/bug`. */
export type TicketDetector = 'cerberus' | 'nightly';
export type TicketPriority = 'low' | 'medium' | 'high';
export type TicketFiling = {
  source: TicketDetector;
  /** The detector's name for what it saw (`check:<node>/<key>`): a second filing of it finds the open ticket. */
  key: string;
  /** A service `charters/bugs.toml` names; its folder is the one the ticket is filed against. */
  service: string;
  title: string;
  words: string;
  priority: TicketPriority;
};

/** The dispatcher's entry point, the ceiling, and the sessionless environment, composed per call. */
function commands(): CommandDependencies {
  return { bin: dispatcherBin(), timeoutMs: TICKET_TIMEOUT_MS, env: sessionlessEnv() };
}

/**
 * The one line the caller logs: the dispatcher's first stdout line (its answer, or its `REFUSED bug <act>: …`); else,
 * when it never answered (no exit code), a sentence naming the ceiling; else the last non-blank stderr line (a
 * traceback names its exception last); else how the command exited.
 */
function answerOf(act: 'file' | 'cleared', result: DispatcherCommandResult): string {
  const said = firstLine(result.stdout);
  if (said !== '') return said;
  // No exit code means the dispatcher never answered: killed at the ceiling, or never started. stderr then holds execFile's
  // own `Command failed: <argv>`, which names no cause, so the answer names the ceiling instead.
  if (result.exit === null) {
    return `bug ${act} did not answer within ${TICKET_TIMEOUT_MS / 1000} s (stopped at the ceiling, or it could not be started)`;
  }
  const stderrLines = result.stderr.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const last = stderrLines[stderrLines.length - 1] ?? '';
  if (last !== '') return last.slice(0, ANSWER_LINE_CHARS);
  return `bug ${act} exited ${result.exit ?? 'without an answer'}`;
}

/**
 * Files one ticket on the house's bug line with `filing.words` on stdin. Answers the dispatcher's one line
 * (an `ALREADY FILED` or a refusal included); never throws.
 */
export async function fileTicket(filing: TicketFiling): Promise<string> {
  try {
    const result = await runDispatcherCommand(
      commands(),
      [
        'bug', 'file', '--title', filing.title, '--priority', filing.priority,
        '--service', filing.service, '--key', filing.key, '--source', filing.source,
      ],
      filing.words,
    );
    return answerOf('file', result);
  } catch (error) {
    return `bug file did not run: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Says the ticket holding `key` is gone, with `note` as the reason. Answers the dispatcher's one line;
 * never throws.
 */
export async function clearTicket(key: string, note: string): Promise<string> {
  try {
    const result = await runDispatcherCommand(commands(), ['bug', 'cleared', '--key', key, '--note', note]);
    return answerOf('cleared', result);
  } catch (error) {
    return `bug cleared did not run: ${error instanceof Error ? error.message : String(error)}`;
  }
}
