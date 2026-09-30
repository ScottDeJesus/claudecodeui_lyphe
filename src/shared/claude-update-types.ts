//----------------- CLAUDE UPDATE CONTRACTS ------------
// The client's view of the Claude update pipeline: every shape the Settings → Updates tab and the
// sidebar row read off a wire or hand back to it.
//
// It mirrors `server/shared/claude-update-types.ts` field for field, and that file is the one place
// to look when a shape here seems wrong. The two edit TOGETHER: a field renamed on one side and not
// the other is a report the tab quietly stops reading.
//
// It imports NOTHING from `server/`: the client tsconfig does not compile server code, and an
// `import type` across that boundary is a bundle that cannot build.
//
// It is a SIBLING of `src/shared/types.ts` rather than an addition to it, for the reason the two
// `kanban-types.ts` files are siblings of their own `types.ts`: that file is 2673 lines and the
// house ceiling for a module is 300. `src/shared/` already carries `authToken.ts`, `constants.ts`,
// `uiPreferences.ts` and more beside `types.ts`, so this is the existing convention.
//
// Two readings the whole contract stands on: every time is epoch MILLISECONDS, and a null version
// is "not known" — the tab prints no version at all rather than a `0.0.0` it would have to unlearn.

/**
 * Which package an update is about. `cli` is the Claude Code binary a run spawns, installed
 * globally with npm; `sdk` is the Agent SDK package this repo pins in its own `package.json`.
 */
export type ClaudeUpdatePackageKey = 'cli' | 'sdk';

/**
 * One `## x.y.z` section of a changelog: the heading itself is excluded and the markdown under it
 * is kept verbatim, so the patch notes render through `MarkdownPreview` as written.
 */
export type ClaudeUpdateNote = { version: string; body: string };

/** One package as the report carries it — one card in the tab. */
export type ClaudeUpdatePackage = {
  key: ClaudeUpdatePackageKey;
  /** The npm name, as the registry knows it. */
  name: string;
  /** 'Claude Code' | 'Claude Agent SDK'. */
  label: string;
  /** On disk now, or null when the server could not read it. */
  installed: string | null;
  /** What THIS API process imported at boot. cli: always null — a conversation announces its own. */
  loaded: string | null;
  /** The npm dist-tag `latest` at the last check. */
  latest: string | null;
  /** `installed` and `latest` are both strings, and `installed` is behind `latest` (ordered). */
  updateAvailable: boolean;
  /** False when the pipeline cannot install this package here. */
  updatable: boolean;
  /** Plain words: why `installed` or `latest` is null, or why the package is not updatable. */
  reason: string | null;
  /** Every changelog section with installed < version <= latest, newest first. */
  notes: ClaudeUpdateNote[];
  /** Why the notes are missing or short while an update is available. */
  notesReason: string | null;
  /** The human page of the full changelog, opened in a new tab. */
  changelogUrl: string;
};

/** The four steps a job can be made of, in the order they run. */
export type ClaudeUpdateStepKey = 'cli' | 'sdk' | 'restart' | 'commit';

/**
 * Where one step stands. `skipped` is a step the job decided not to run (a commit with nothing
 * clean to commit), which is a different thing from one that never ran.
 */
export type ClaudeUpdateStepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** One step of a job, with its own clock and the one line that says what became of it. */
export type ClaudeUpdateStep = {
  key: ClaudeUpdateStepKey;
  state: ClaudeUpdateStepState;
  from: string | null;
  to: string | null;
  detail: string | null;
  startedAt: number | null;
  endedAt: number | null;
};

/**
 * The states a job moves through. While it holds one of `installing`, `installed`, `restarting` or
 * `rolling-back`, the tab polls at its fast rate; the rest are the job at rest.
 */
export type ClaudeUpdateJobState =
  | 'installing'
  | 'installed'
  | 'restarting'
  | 'rolling-back'
  | 'done'
  | 'failed'
  | 'rolled-back'
  | 'interrupted';

/** One update (or rollback) run, as the report carries it. */
export type ClaudeUpdateJob = {
  /** `Date.now().toString(36)`, minted when the job is created. */
  id: string;
  kind: 'update' | 'rollback';
  state: ClaudeUpdateJobState;
  /** Epoch milliseconds. */
  startedAt: number;
  /** Epoch milliseconds, or null while the job is still running. */
  endedAt: number | null;
  /** The detached runner's pid, or null before the spawn has happened. */
  runnerPid: number | null;
  /**
   * In order, and only the steps this job has: cli?, sdk?, then restart and commit exactly when an
   * sdk step is present.
   */
  steps: ClaudeUpdateStep[];
  /** `requestedBy` is the pid that sent the reboot request. */
  restart: { requestedAt: number | null; requestedBy: number | null };
  /** What the repo's two package files looked like before and after the install. */
  packageFiles: {
    cleanAtStart: boolean;
    hashesAfterInstall: { packageJson: string; packageLock: string } | null;
  };
  /**
   * Report-only: the last 40 lines of `job.log`, filled by the API when it answers — never by the
   * file, which always stores this empty.
   */
  logTail: string[];
};

/**
 * Whether the app installs updates itself, and — while one is on offer — why it has not yet.
 *
 * `enabled` is the operator's switch, stored on the server and ON until turned off. `waiting` is the
 * plain reason an available update has not been installed yet: Claude work in flight ("2 Claude
 * conversations are working"), a last attempt at these very versions that did not finish, or simply
 * that the next five-minute check will take it. It is null when nothing is waiting — no update on
 * offer, an install already running, or the switch off — so a non-null `waiting` always means an
 * update is on offer and the app intends to install it.
 */
export type ClaudeAutoInstall = {
  enabled: boolean;
  waiting: string | null;
};

/** What `GET /api/claude-updates` answers, and what every action answers with in turn. */
export type ClaudeUpdatesReport = {
  /** Epoch milliseconds of the last attempt, or null when none has run yet. */
  checkedAt: number | null;
  /** True while a check is in flight in this process. */
  checking: boolean;
  /** The last attempt's failure in words, or null when it read cleanly. */
  checkError: string | null;
  /** Epoch milliseconds when the next check is due, or null before the first one. */
  nextCheckAt: number | null;
  /** This API can hand itself over to a new process. */
  supervised: boolean;
  /** Always `[cli, sdk]`, in that order. */
  packages: ClaudeUpdatePackage[];
  /** The current job, or the last one. */
  job: ClaudeUpdateJob | null;
  /** The automatic install: its switch, and what an update on offer is waiting for. */
  autoInstall: ClaudeAutoInstall;
};

/** What `POST /api/claude-updates/apply` carries: the versions the caller saw on screen. */
export type ClaudeUpdateApplyRequest = { targets: Partial<Record<ClaudeUpdatePackageKey, string>> };

/** Why an action was refused, in one word for the status and one sentence for the person. */
export type ClaudeUpdateRefusal = {
  error:
    | 'bad-request'
    | 'job-active'
    | 'stale-target'
    | 'not-updatable'
    | 'nothing-to-update'
    | 'not-supervised';
  message: string;
};
