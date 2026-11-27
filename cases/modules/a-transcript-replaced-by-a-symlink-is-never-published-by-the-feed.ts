// protects: server/modules/providers/services/transcript-feed.service.ts, server/modules/providers/services/sessions-watcher.service.ts
// writes: none
// A regular transcript the feed holds, replaced by a symlink renamed over it: chokidar (followSymlinks: false) still
// reports 'change' with stats that FOLLOWED the link, so a feed that trusts handed stats for a held path publishes the
// outside file's size. The feed admits a path only on its own lstat's isFile(): no add or change may follow the swap.
import fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import { runCase, held, broken } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const FEED = "../../server/modules/providers/services/transcript-feed.service.ts";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  let mod: any;
  try { mod = await import(FEED); } catch (error: any) { return broken("transcript-feed.service.ts would not load: " + String(error?.message ?? error).split("\n")[0]); }
  if (typeof mod.createTranscriptFeed !== "function") return broken("transcript-feed.service.ts exports no createTranscriptFeed");
  const dir: string = await scratchDir(t, "transcript-feed-symlink-swap");
  const root = path.join(dir, "root", "proj");
  const outside = path.join(dir, "outside");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outside);
  const real = path.join(root, "real.jsonl");
  const other = path.join(outside, "other.jsonl");
  fs.writeFileSync(real, "{\"a\":1}\n");
  fs.writeFileSync(other, "0123456789012345678901234567890123456789\n");

  const events: Array<{ kind: string; size: number; previousSize: number | null }> = [];
  const chokidarSaw: string[] = [];
  const feed = mod.createTranscriptFeed({ settleMs: 250, lstat: (p: string) => fs.promises.lstat(p), logError: () => {} });
  t.defer(() => feed.close());
  feed.subscribe((e: any) => { if (e.filePath === real) events.push({ kind: e.kind, size: e.size, previousSize: e.previousSize }); });

  // Wired as initializeSessionsWatcher wires it: the watcher's chokidar options and its ready flag.
  let ready = false;
  const watcher = chokidar.watch(path.join(dir, "root"), { persistent: true, ignoreInitial: false, followSymlinks: false, depth: 6 });
  t.defer(() => watcher.close());
  watcher.on("add", (p: string, s?: fs.Stats) => { if (!p.endsWith(".jsonl")) return; if (ready) feed.report("add", "claude", p, s); else feed.seen("claude", p, s); });
  watcher.on("change", (p: string, s?: fs.Stats) => { if (p === real) chokidarSaw.push("change size " + s?.size); if (p.endsWith(".jsonl")) feed.report("change", "claude", p, s); });
  watcher.on("unlink", (p: string) => { if (p.endsWith(".jsonl")) feed.report("unlink", "claude", p); });
  await new Promise<void>((resolve) => watcher.on("ready", () => { ready = true; resolve(); }));
  await sleep(100);

  const tmpLink = path.join(root, "swap-link");
  fs.symlinkSync(other, tmpLink);
  fs.renameSync(tmpLink, real);                       // real.jsonl is now a link to a file outside the root
  await sleep(800);
  fs.appendFileSync(other, "MORE-OUTSIDE-BYTES\n");
  await sleep(800);

  const published = events.filter((e) => e.kind === "add" || e.kind === "change");
  if (published.length) return broken("after a symlink was renamed over real.jsonl the feed published " + JSON.stringify(published) + " (the outside file is 41, then 60 bytes); chokidar handed " + JSON.stringify(chokidarSaw));
  if (!chokidarSaw.length) return broken("chokidar reported no change for real.jsonl after the swap, so the case judged nothing (heard " + JSON.stringify(events) + ")");
  return held("chokidar reported " + JSON.stringify(chokidarSaw) + " for the swapped path and the feed published no add or change for it (heard " + JSON.stringify(events) + ")");
});
