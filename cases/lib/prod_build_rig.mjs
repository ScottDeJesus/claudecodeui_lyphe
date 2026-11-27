// prod_build_rig.mjs — the production client's build watcher run over a scratch repo with a stand-in build.
//
//   import { buildRig, WATCHER } from "../lib/prod_build_rig.mjs";
//   const rig = await buildRig(t, { buildSeconds: 1 });   // null when this checkout has no watcher
//   rig.start(); await rig.waitFor(() => rig.builds().length >= 1, 15000);
//   const savedAt = rig.save("src/deep/a.ts");            // rig.builds(): [{ start, end }] in ms, from the stand-in's log
//   rig.terminate(); await rig.waitFor(() => rig.exit(), 5000); rig.kill() in a finally
//
// The scratch repo holds copies of deploy/prod-client-watch/ and deploy/tree-watch/ from this checkout, and in
// scripts/prod-client-build.sh a stand-in that answers --inputs with src, index.html and package.json and otherwise
// logs its start and end to .prod-client/builds.log (where the real build writes), sleeps buildSeconds and prints
// "prod client built: stand-in-<n>". The watcher runs as a child process with the scratch repo as its working directory.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { scratchDir } from "./scratch.mjs";

const REPO = path.resolve(new URL("../..", import.meta.url).pathname);
export const WATCHER = "deploy/prod-client-watch/watch-build.mjs";

const STAND_IN = [
  "#!/usr/bin/env bash",
  "# A stand-in for scripts/prod-client-build.sh: it names three inputs, and a build is a logged sleep.",
  "cd \"$(dirname \"$0\")/..\" || exit 1",
  "if [ \"$1\" = \"--inputs\" ]; then echo src; echo index.html; echo package.json; exit 0; fi",
  "mkdir -p .prod-client",
  "echo \"start $(date +%s%3N)\" >> .prod-client/builds.log",
  "sleep \"$(cat build-seconds)\"",
  "n=$(grep -c '^start' .prod-client/builds.log)",
  "echo \"end $(date +%s%3N)\" >> .prod-client/builds.log",
  "echo \"prod client built: stand-in-$n\"",
  "",
].join("\n");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The scratch repo and the watcher's handle; null when this checkout carries no watcher. */
export async function buildRig(t, { buildSeconds }) {
  if (!fs.existsSync(path.join(REPO, WATCHER))) return null;
  const root = await scratchDir(t, "prod-build-watch");
  for (const dir of ["deploy/prod-client-watch", "deploy/tree-watch"]) {
    fs.cpSync(path.join(REPO, dir), path.join(root, dir), { recursive: true });
  }
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "scripts", "prod-client-build.sh"), STAND_IN, { mode: 0o755 });
  fs.mkdirSync(path.join(root, "src", "deep"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "deep", "a.ts"), "export {};\n");
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html>\n");
  fs.writeFileSync(path.join(root, "package.json"), "{}\n");
  fs.writeFileSync(path.join(root, "build-seconds"), String(buildSeconds));
  const log = path.join(root, ".prod-client", "builds.log");
  const lines = [];
  let child = null;
  let exit = null;
  let pending = "";
  const take = (chunk) => {
    pending += chunk.toString();
    const parts = pending.split("\n");
    pending = parts.pop();
    for (const text of parts) lines.push({ at: Date.now(), text });
  };
  return {
    root,
    start() {
      child = spawn(process.execPath, [path.join(root, WATCHER)], {
        cwd: root,
        env: { ...process.env, NODE_ENV: "production" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", take);
      child.stderr.on("data", (chunk) => process.stderr.write(chunk));
      child.on("exit", (code, signal) => {
        exit = { at: Date.now(), code, signal };
      });
    },
    save(relativePath) {
      fs.writeFileSync(path.join(root, relativePath), "// saved " + Date.now() + "\n");
      return Date.now();
    },
    builds() {
      let text = "";
      try {
        text = fs.readFileSync(log, "utf8");
      } catch {
        return [];
      }
      const found = [];
      for (const line of text.split("\n")) {
        const [kind, value] = line.split(" ");
        if (kind === "start") found.push({ start: Number(value), end: null });
        if (kind === "end") {
          const open = found.find((build) => build.end === null);
          if (open) open.end = Number(value);
        }
      }
      return found;
    },
    lines: () => lines.map((line) => line.text),
    exit: () => exit,
    terminate() {
      if (child && exit === null) child.kill("SIGTERM");
      return Date.now();
    },
    kill() {
      if (child && exit === null) child.kill("SIGKILL");
    },
    async waitFor(predicate, withinMs) {
      const until = Date.now() + withinMs;
      while (Date.now() < until) {
        if (predicate()) return true;
        await sleep(100);
      }
      return Boolean(predicate());
    },
  };
}
