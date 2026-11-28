// protects: server/modules/universe/universe-heads.service.ts, server/modules/universe/universe-heads.watch.ts
// writes: none
//
// headFilesOf names exactly the files readRepoHead reads a HEAD from, for a main checkout, a linked worktree
// (its own git dir and the common one) and a detached HEAD: the one statement of git's layout the HEAD watch takes.

import fs from "node:fs";
import path from "node:path";

import { broken, CannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const SERVER = "/home/lyphe/.claude/claudecodeui_lyphe/server";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls a test every 20 ms until it holds or the time is up; answers whether it held. */
async function waitFor(test: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (test()) return true;
    await sleep(20);
  }
  return test();
}

/** A server module by its path: a file not on disk is null (the promise's own break), a load failure cannot run. */
async function load(file: string): Promise<any> {
  if (!fs.existsSync(file)) return null;
  try {
    return await import(file);
  } catch (error: any) {
    throw new CannotRun(file + " would not load — " + String(error?.message ?? error).split("\n")[0]);
  }
}

import { execFileSync } from "node:child_process";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=case", "-c", "user.email=case@localhost", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });
}

runCase(async (t: any) => {
  const heads = await load(SERVER + "/modules/universe/universe-heads.service.ts");
  if (heads === null) throw new CannotRun("server/modules/universe/universe-heads.service.ts is not on disk");
  if (typeof heads.headFilesOf !== "function") return broken("universe-heads.service.ts exports no headFilesOf: a watch has no layout to take but its own");
  const root = fs.realpathSync(await scratchDir(t, "head-files"));
  const main = path.join(root, "main");
  const wt = path.join(root, "wt");
  git(root, "init", "-q", "-b", "main", main);
  git(main, "commit", "-q", "--allow-empty", "-m", "first");
  git(main, "worktree", "add", "-q", "-b", "wt", wt);

  const files = (repo: string): string[] => heads.headFilesOf(repo).map((f: any) => path.resolve(f.dir, f.name)).sort();
  const dotGit = path.join(main, ".git");
  const wtGit = path.join(dotGit, "worktrees", "wt");
  const legs: Array<[string, string[], string[]]> = [];
  legs.push(["main", files(main), [path.join(dotGit, "HEAD"), path.join(dotGit, "refs", "heads", "main"), path.join(dotGit, "packed-refs")].sort()]);
  legs.push(["worktree", files(wt), [path.join(wtGit, "HEAD"), path.join(wtGit, "refs", "heads", "wt"), path.join(dotGit, "refs", "heads", "wt"), path.join(dotGit, "packed-refs")].sort()]);
  git(main, "checkout", "-q", "--detach");
  legs.push(["detached", files(main), [path.join(dotGit, "HEAD"), path.join(dotGit, "packed-refs")].sort()]);

  const rel = (list: string[]) => list.map((p) => path.relative(root, p)).join(" ");
  const wrong = legs.filter(([, got, want]) => JSON.stringify(got) !== JSON.stringify(want)).map(([label, got, want]) => label + ": named " + rel(got) + ", not " + rel(want));
  if (wrong.length) return broken(wrong.join("; "));
  return held(legs.map(([label, got]) => label + ": " + rel(got)).join("; "));
});
