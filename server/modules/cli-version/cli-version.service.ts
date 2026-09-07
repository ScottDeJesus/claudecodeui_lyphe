import type { CliVersionReport, CliVersionRun } from '@/shared/types.js';

/**
 * How long one successful `--version` answer stands before the binary is asked
 * again.
 *
 * The client polls this route, and spawning a process per poll would bill a
 * subprocess for a number that only changes when someone runs an installer.
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
   * confident wrong number — worse than saying nothing. The composition root
   * resolves this through the same function the SDK spawn side uses.
   */
  resolveBinaryPath: () => string | null;
  execFile: RunVersionCommand;
  now: () => number;
  /** The chat run registry's own projection. This service joins nothing — the registry already holds each run's version. */
  listRunningRuns: () => CliVersionRun[];
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

  async function probeInstalledVersion(): Promise<InstalledCliVersion> {
    const checkedAt = dependencies.now();
    const binaryPath = dependencies.resolveBinaryPath();

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
      const result = await dependencies.execFile(binaryPath, ['--version'], {
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

  function installed(): Promise<InstalledCliVersion> {
    const standsFor = lastProbe?.version ? INSTALLED_CACHE_MS : FAILED_PROBE_CACHE_MS;
    if (lastProbe && dependencies.now() - lastProbe.checkedAt < standsFor) {
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
        lastProbe = result;
        return result;
      })
      .finally(() => {
        probeInFlight = null;
      });

    return probeInFlight;
  }

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
