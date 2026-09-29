/**
 * The shape of a git answer, for the three places in this module that ask git something: the commit
 * (`update-commit.ts`), the clean-at-start test before a job is created
 * (`update-actions.service.ts`), and the reconciler, which carries the runner to both.
 *
 * Two aliases and nothing else, deliberately. They are not in `server/shared/claude-update-types.ts`
 * because that file is the WIRE contract, mirrored field for field into the client — and a git
 * verdict never leaves this process. The one implementation that answers in this shape is built in
 * `claude-updates.module.ts` (the `execFile` call is there, so this module never spawns anything
 * itself) and handed to each of the three.
 *
 * `code` is null for a git that could not be started at all — no binary, no cwd — which is a
 * different thing from a git that ran and refused, and it is the difference a caller testing
 * `code === 0` must not have to guess at.
 */

/** One git command's verdict. `stdout`/`stderr` are the process's own words, never re-cut. */
export type GitResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

/** Runs one git command by argv and answers its verdict. Never rejects: see the module's runner. */
export type RunGit = (argv: string[]) => Promise<GitResult>;
