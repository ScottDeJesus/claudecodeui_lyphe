// protects: server/modules/universe/universe-heads.watch.ts, server/modules/universe/universe-heads.service.ts, server/shared/directory-watch.service.ts
// writes: none
//
// The HEAD watch hears a registered repo's HEAD move however git moves it: a commit, a branch checked out in a
// new ref folder, a pack-refs, a branch born in a folder that did not exist (waited for at its nearest existing
// ancestor), and the registry file itself. Scratch repo and registry; onMove counted, no map built.

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

const WITHIN_MS = 1000;
/** Before each act, so what the last one stirred is heard before the mark. */
const DRAIN_MS = 400;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=case", "-c", "user.email=case@localhost", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });
}

runCase(async (t: any) => {
  const watchMod = await load(SERVER + "/modules/universe/universe-heads.watch.ts");
  if (watchMod === null || typeof watchMod.createHeadsWatch !== "function") return broken("no createHeadsWatch in server/modules/universe/universe-heads.watch.ts: nothing hears a HEAD move");
  const root = fs.realpathSync(await scratchDir(t, "heads-watch"));
  const repo = path.join(root, "repo");
  const registryFile = path.join(root, "registry.json");
  fs.writeFileSync(registryFile, "[]");
  git(root, "init", "-q", "-b", "main", repo);
  git(repo, "commit", "-q", "--allow-empty", "-m", "first");

  const moves: number[] = [];
  const errors: string[] = [];
  const watch = watchMod.createHeadsWatch({
    registryFile,
    repos: () => [{ id: "case-repo", path: repo }],
    onMove: () => moves.push(Date.now()),
    logError: (message: string) => errors.push(message),
  });
  t.defer(() => watch.stop());
  watch.start();

  const wrong: string[] = [];
  const saw: string[] = [];
  const leg = async (label: string, act: () => void): Promise<void> => {
    await sleep(DRAIN_MS);
    const mark = moves.length;
    const at = Date.now();
    act();
    if (await waitFor(() => moves.length > mark, WITHIN_MS)) saw.push(label + " " + (moves[mark] - at) + " ms");
    else wrong.push(label + ": no onMove within " + WITHIN_MS + " ms");
  };
  await leg("commit", () => git(repo, "commit", "-q", "--allow-empty", "-m", "second"));
  await leg("checkout of feature/deep", () => git(repo, "checkout", "-q", "-b", "feature/deep"));
  await leg("commit on feature/deep", () => git(repo, "commit", "-q", "--allow-empty", "-m", "deep"));
  await leg("pack-refs", () => git(repo, "pack-refs", "--all"));
  await leg("HEAD to unborn later/x", () => git(repo, "symbolic-ref", "HEAD", "refs/heads/later/x"));
  await leg("first commit on later/x", () => git(repo, "commit", "-q", "--allow-empty", "-m", "later"));
  await leg("registry write", () => fs.writeFileSync(registryFile, "[ ]"));
  if (wrong.length) return broken(wrong.join("; ") + (errors.length ? " | logged: " + errors.join("; ") : ""));
  return held("onMove after " + saw.join(", "));
});
