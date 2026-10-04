import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { promisify } from 'node:util';

import { resolveSpawnedClaudeBinaryPath } from '@/shared/claude-cli-path.js';
import type { CliVersionReport, CliVersionRun } from '@/shared/types.js';

import { noteInstalledVersionReading } from './cli-version-change.js';

const execFileAsync = promisify(execFile);

/**
 * How long one successful `--version` answer stands before the binary is asked
 * again.
 *
 * The client polls this route, and spawning a process per poll would bill a
 * subprocess for a number that only changes when someone runs an installer.
 *
 * A success stands this long only while the binary behind it is the same file it
 * was read from — see `fingerprintOf`. The window is how often an installer
 * can be noticed without a spawn per poll, and it is not a claim that the file
 * cannot change inside it: an install rewrites that file, the next ask sees a
 * different mtime and probes, so an upgrade is visible on the first ask after it
 * happened rather than on the first ask after the window ended.
 */
const INSTALLED_CACHE_MS = 60_000;

/**
 * How long a FAILED probe stands. Much shorter than a success, because the two
 * are not the same fact: a version changes when someone runs an installer, but
 * a failure ends the moment they finish running it — and the operator repairing
 * a broken CLI is exactly the person watching this route. One spawn per ten
 * seconds is a price worth paying to let a repair show up while they are still
 * looking at it; the expensive failure (a hung binary) is bounded anyway by the
 * exec timeout below and by the shared in-flight probe.
 */
const FAILED_PROBE_CACHE_MS = 10_000;

/**
 * One `--version` call's ceiling. A binary that hangs is a binary that cannot
 * answer, and without this the route would hang with it.
 */
const VERSION_PROBE_TIMEOUT_MS = 10_000;

/** `2.1.261 (Claude Code)`, or `v2.1.261` — the leading triple on a line, with an optional `v`. */
const VERSION_PATTERN = /^v?(\d+\.\d+\.\d+)/;

/** How the CLI signs its own version line, measured: `2.1.261 (Claude Code)`. */
const CLI_SIGNATURE = /\(claude code\)/i;

/** A weaker signature, for any build whose line names Claude without the parenthesised product. */
const NAMES_CLAUDE = /claude/i;

/**
 * Reads the version out of whatever `--version` printed.
 *
 * Line-wise, not anchored to the buffer: on a host where `claude` is an nvm or
 * asdf shim, or an npm wrapper, the real answer arrives after a line the shim
 * printed first. Anchoring to the start of stdout reads a perfectly healthy
 * install as unreadable.
 *
 * But taking the first version-shaped line is worse than useless, because some
 * of those shims announce THEIR OWN version — `v24.0.0` on line one, the CLI's
 * on line two — and a wrong number reported as a successful read is the one
 * outcome this route must never produce.
 *
 * So the CLI is identified rather than positioned, most specific first: the
 * parenthesised product it actually signs with, then any line naming Claude,
 * then any candidate at all. A rung answers only when it holds exactly ONE
 * line — two lines equally entitled to a rung are a tie, and a tie is a guess,
 * so the ladder falls through and ends at `null`. Position decides nothing at
 * any rung, because a wrapper can print on either side of the binary it
 * delegates to — and a wrapper named `claude-something` defeats a name test
 * alone.
 *
 * WHICH version is right, when a wrapper has one of its own: the CLI's. This
 * number exists to be compared against `running[].cliVersion`, which the SDK
 * takes from the init message of the delegated Claude Code process — so the
 * wrapper's version could never equal it, and reporting it would mark every
 * live run stale forever.
 */
function readVersionFromOutput(stdout: string): string | null {
  const candidates = stdout
    .split('\n')
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = VERSION_PATTERN.exec(line);
      return match ? [{ version: match[1], line }] : [];
    });

  const claimed = [
    candidates.filter((candidate) => CLI_SIGNATURE.test(candidate.line)),
    candidates.filter((candidate) => NAMES_CLAUDE.test(candidate.line)),
    candidates,
  ].find((rung) => rung.length === 1)?.[0];

  return claimed?.version ?? null;
}

/**
 * What the installed binary answered, and when it was asked.
 *
 * `version` and `reason` are exclusive: a read version carries no reason, and a
 * null version always carries one. Nothing here ever invents `0.0.0` — a made-up
 * version compares equal to nothing and stale to everything.
 */
type InstalledCliVersion = {
  version: string | null;
  reason: string | null;
  binaryPath: string | null;
  checkedAt: number;
};

/**
 * Runs one command and resolves its stdout. Shaped for `promisify(execFile)`,
 * and injected so a probe can point the service at a binary that is not there
 * — or count how many times it was actually spawned.
 */
type RunVersionCommand = (
  file: string,
  args: readonly string[],
  options: { timeout: number },
) => Promise<{ stdout: string }>;

type CliVersionServiceDependencies = {
  /**
   * The exact binary a provider run will spawn, or null when this process
   * cannot name one.
   *
   * ONE dependency on purpose. The version that matters is the one the RUNS
   * are on, so the probe must not have a resolution rule of its own: two rules
   * drift, and a probe that answers about a binary nothing spawns reports a
   * confident wrong number — worse than saying nothing. Left out, it is
   * `resolveSpawnedClaudeBinaryPath`, the same function the SDK spawn side uses.
   */
  resolveBinaryPath?: () => string | null;
  execFile?: RunVersionCommand;
  now?: () => number;
  /** The chat run registry's own projection. This service joins nothing — the registry already holds each run's version. */
  listRunningRuns: () => CliVersionRun[];
  /**
   * The reading to serve, when this caller wants the whole server to share one.
   *
   * `report()` is not the only consumer any more: the chat runtime asks the same
   * question at send time, to retire a process older than the binary on disk. Two
   * caches would be two answers for up to a window — the route telling a person to
   * restart a conversation the runtime had already decided to replace, or the
   * reverse — so production passes `readInstalledCliVersion` here and the runtime
   * asks that same reading directly. Omitted, the reading is built from the three
   * dependencies above, which is how a probe drives the failure paths and the
   * cache without a server, a binary or a real clock.
   */
  readInstalled?: () => Promise<InstalledCliVersion>;
};

/**
 * The CLI version service: what is installed, and what the live runs are on.
 *
 * The two facts are gathered separately and never substituted for each other.
 * `installed` is this machine's binary answering `--version` now; a run's
 * `cliVersion` is what THAT run's own process announced at init, captured
 * through the chat writer. Filling a run's null from the installed probe would
 * make every run look current — which is exactly the state this route exists to
 * detect.
 */
export function createCliVersionService(dependencies: CliVersionServiceDependencies): {
  installed(): Promise<InstalledCliVersion>;
  report(): Promise<CliVersionReport>;
} {
  let lastProbe: InstalledCliVersion | null = null;
  let probeInFlight: Promise<InstalledCliVersion> | null = null;
  let lastFingerprint: string | null = null;
  // The real wiring is here rather than at the route's composition root, so that the route and
  // the chat runtime can be handed the SAME cached reading (`readInstalledCliVersion` below): a
  // second wiring beside this one would be a second cache, and two caches are two answers.
  const resolveBinaryPath = dependencies.resolveBinaryPath ?? (() => resolveSpawnedClaudeBinaryPath());
  const now = dependencies.now ?? (() => Date.now());
  const runVersionCommand: RunVersionCommand =
    dependencies.execFile ?? ((file, args, options) => execFileAsync(file, [...args], options));

  /**
   * What the binary a reading was taken from IS right now: the path that reading names, and the
   * mtime of the file it resolves to.
   *
   * A cached version is a claim about a FILE, and a claim outlives its subject the moment someone
   * runs an installer. Ask that file instead of waiting out the clock: an install rewrites it or
   * repoints the path at a new one, either of which changes this string, and the next ask probes.
   * `stat` follows the symlink an npm install puts there, so the mtime is the CLI's own file, and a
   * repoint is caught even when the new target's mtime is older than the last probe's (a reinstall
   * of an earlier version) — while a path that is no longer there at all changes the string too,
   * which is how a relocated binary is noticed.
   *
   * The argument is the path the READING recorded, never a fresh resolution: that is the file the
   * version came from, it costs no resolver call, and a resolver is asked once per probe and no
   * more. A `null` path (the CLI is chosen when a run starts) has no file to watch, so the time
   * windows above decide — exactly as they did before this existed.
   */
  function fingerprintOf(binaryPath: string | null): string | null {
    if (!binaryPath) return null;
    try {
      return `${binaryPath}@${statSync(binaryPath).mtimeMs}`;
    } catch {
      // Not a file right now, which is itself a stable fact and must be able to DIFFER from a
      // stat'able one: a binary appearing or disappearing re-probes rather than standing on a clock.
      return `${binaryPath}@not-a-file`;
    }
  }

  async function probeInstalledVersion(): Promise<InstalledCliVersion> {
    const checkedAt = now();
    const binaryPath = resolveBinaryPath();

    if (!binaryPath) {
      // Deferral, not absence. On a default install the CLI is present and chat
      // works — the file is simply picked from PATH (or from the run's own
      // directory) when a run starts, so nothing was searched for and missed.
      // Saying "not found" here would report a healthy machine as broken.
      return {
        version: null,
        reason: 'the Claude CLI is chosen when a run starts, so its version is not known in advance',
        binaryPath: null,
        checkedAt,
      };
    }

    let stdout: string;
    try {
      const result = await runVersionCommand(binaryPath, ['--version'], {
        timeout: VERSION_PROBE_TIMEOUT_MS,
      });
      stdout = String(result.stdout ?? '');
    } catch {
      // The error itself is not repeated outward: it carries a path and a
      // spawn errno, and neither tells the reader anything they can act on.
      return {
        version: null,
        reason: 'the Claude CLI did not answer --version',
        binaryPath,
        checkedAt,
      };
    }

    const version = readVersionFromOutput(stdout);
    return {
      version,
      reason: version ? null : 'the Claude CLI answered --version with something unreadable',
      binaryPath,
      checkedAt,
    };
  }

  /** This instance's own cached probe — the reading a probe drives through the three dependencies. */
  function cachedInstalled(): Promise<InstalledCliVersion> {
    // The binary the last reading was about, as it is NOW. `null` (no reading yet, or a reading
    // with no path) is not a change: there is nothing to have changed.
    const fingerprint = fingerprintOf(lastProbe?.binaryPath ?? null);
    const binaryChanged = fingerprint !== null && fingerprint !== lastFingerprint;
    const standsFor = lastProbe?.version ? INSTALLED_CACHE_MS : FAILED_PROBE_CACHE_MS;
    if (!binaryChanged && lastProbe && now() - lastProbe.checkedAt < standsFor) {
      return Promise.resolve(lastProbe);
    }

    // The in-flight probe is shared, not just the finished one: two callers
    // arriving together on a cold cache are one question, and answering it
    // twice would spawn the binary twice for the same window.
    //
    // Cleared in a `finally`, never on the fulfilled path alone: `??=` will not
    // reassign a non-null slot, so a probe that ever rejected would be handed
    // back — still rejected — to every caller for the life of the process.
    probeInFlight ??= probeInstalledVersion()
      .then((result) => {
        // The one place an INSTALL is visible: the reading this answer replaces is still in hand
        // here, and nowhere else — the cache is overwritten on the next line. Everything that acts
        // on "the binary changed" (the keepalive retiring an idle host on the old build) subscribes
        // to that transition rather than polling for it; see `cli-version-change.ts`.
        noteInstalledVersionReading(lastProbe?.version ?? null, result.version);
        lastProbe = result;
        // The fingerprint of the file the path held when this answer was taken, recorded beside it.
        // Taken AFTER the probe, so a binary swapped WHILE the probe ran makes the pair disagree —
        // the reading is the exec'd file's, the fingerprint the replacement's — and the cache then
        // serves that pre-swap reading for the rest of its window instead of re-probing. Narrow (the
        // swap must land inside the probe) and named in `docs/MANUAL.md (cli-version)`'s "what is left
        // standing" bullets. What the fingerprint is for is the common case, a file that changed
        // BETWEEN two asks: there it re-probes on the next ask rather than serving a stale reading.
        lastFingerprint = fingerprintOf(result.binaryPath);
        return result;
      })
      .finally(() => {
        probeInFlight = null;
      });

    return probeInFlight;
  }

  const installed = dependencies.readInstalled ?? cachedInstalled;

  return {
    installed,

    async report(): Promise<CliVersionReport> {
      const probe = await installed();

      return {
        installed: probe.version,
        reason: probe.reason,
        binaryPath: probe.binaryPath,
        running: dependencies.listRunningRuns().map((run) => ({
          sessionId: run.sessionId,
          startedAt: run.startedAt,
          cliVersion: run.cliVersion,
        })),
      };
    },
  };
}

/**
 * The one reading of the installed binary this process serves, and the one the chat runtime
 * asks at send time.
 *
 * ONE cache, deliberately. The route tells a person that a conversation is on an older CLI
 * and offers to restart it; the runtime retires an idle process older than the binary on
 * disk at its next message. Those two must be reading the same fact at the same moment, or
 * for the length of a window one of them says "restart" about a conversation the other has
 * already replaced. The runtime acts on the version, so it cannot be handed a stale copy of
 * a newer answer — which is what a second cache beside this one would give it.
 *
 * A reading also stops standing the moment the binary changes on disk, not merely when the window
 * ends (`binaryFingerprint`). Both callers inherit that: the route stops telling a person to
 * restart a conversation the runtime is about to replace, and the runtime stops comparing against a
 * version that has already been installed over.
 *
 * A probe that needs the failure paths or the cache itself does not come through here; it
 * builds a service from the three dependencies (`cli-version.service.ts`'s own contract, and
 * what `.verify/phase-14.mjs` drives).
 */
let sharedInstalled: { installed(): Promise<InstalledCliVersion> } | null = null;

export function readInstalledCliVersion(): Promise<InstalledCliVersion> {
  sharedInstalled ??= createCliVersionService({ listRunningRuns: () => [] });
  return sharedInstalled.installed();
}
