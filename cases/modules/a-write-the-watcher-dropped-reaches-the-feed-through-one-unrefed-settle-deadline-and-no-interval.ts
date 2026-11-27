// protects: server/modules/providers/services/transcript-feed.service.ts
// writes: none
// A write chokidar dropped (a second write 2 ms after the first, never reported) reaches the feed's subscribers through
// the file's one settle deadline: setTimeout, unreferenced, never setInterval; the same size ends it, a deleted file
// ends it silently.
import fs from "node:fs";
import path from "node:path";
import { runCase, held, broken } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const FEED = "../../server/modules/providers/services/transcript-feed.service.ts";
const SETTLE = 150;
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const sleep = (ms: number) => new Promise((resolve) => realSetTimeout(resolve, ms));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  let source = "";
  try { source = fs.readFileSync(new URL(FEED, import.meta.url), "utf8"); } catch (error: any) { return broken("transcript-feed.service.ts is not there: " + String(error?.message ?? error).split("\n")[0]); }
  if (/\bsetInterval\b/.test(source)) return broken("transcript-feed.service.ts names setInterval");
  let mod: any;
  try { mod = await import(FEED); } catch (error: any) { return broken("transcript-feed.service.ts would not load: " + String(error?.message ?? error).split("\n")[0]); }
  if (typeof mod.createTranscriptFeed !== "function") return broken("transcript-feed.service.ts exports no createTranscriptFeed");

  const armed: any[] = [];
  let intervals = 0;
  (globalThis as any).setTimeout = (fn: any, ms?: number, ...rest: any[]) => {
    const timer = (realSetTimeout as any)(fn, ms, ...rest);
    if (ms === SETTLE) armed.push(timer);
    return timer;
  };
  (globalThis as any).setInterval = (...args: any[]) => { intervals += 1; return (realSetInterval as any)(...args); };
  t.defer(() => { (globalThis as any).setTimeout = realSetTimeout; (globalThis as any).setInterval = realSetInterval; });

  const dir: string = await scratchDir(t, "transcript-feed-settle");
  const errors: string[] = [];
  const events: Array<{ kind: string; name: string; size: number; previousSize: number | null }> = [];
  const feed = mod.createTranscriptFeed({ settleMs: SETTLE, lstat: (p: string) => fs.promises.lstat(p), logError: (m: string) => errors.push(m) });
  t.defer(() => feed.close());
  feed.subscribe((e: any) => events.push({ kind: e.kind, name: path.basename(e.filePath), size: e.size, previousSize: e.previousSize }));
  const of = (name: string) => events.filter((e) => e.name === name).map((e) => e.kind + " " + e.size + " prev " + e.previousSize).join(", ");

  const agent = path.join(dir, "agent-1.jsonl");
  fs.writeFileSync(agent, "one\n");                       // 4
  feed.report("add", "claude", agent, fs.lstatSync(agent));
  await sleep(2);
  fs.appendFileSync(agent, "two\n");                      // 8: the write chokidar dropped, never reported
  await sleep(SETTLE / 3);
  const early = of("agent-1.jsonl");
  await sleep(SETTLE * 3);
  const settled = of("agent-1.jsonl");
  await sleep(SETTLE * 3);
  const later = of("agent-1.jsonl");

  const gone = path.join(dir, "gone.jsonl");
  fs.writeFileSync(gone, "x\n");
  feed.report("add", "claude", gone, fs.lstatSync(gone));
  fs.unlinkSync(gone);                                    // deleted, never reported
  await sleep(SETTLE * 3);
  const goneHeard = of("gone.jsonl");

  if (early !== "add 4 prev null") return broken("before settleMs the feed had published [" + early + "], wanted only the add");
  if (settled !== "add 4 prev null, change 8 prev 4") return broken("after the settle deadline the feed had published [" + settled + "], wanted add 4 prev null, change 8 prev 4");
  if (later !== settled) return broken("the deadline did not end at the same size: [" + later + "]");
  if (goneHeard !== "add 2 prev null") return broken("a file deleted before its deadline published [" + goneHeard + "]");
  if (errors.length) return broken("logError was called: " + errors.join(" | "));
  if (intervals !== 0) return broken("the feed armed " + intervals + " setInterval");
  if (armed.length < 3) return broken("only " + armed.length + " settle deadlines were armed with setTimeout at settleMs, wanted at least 3");
  const reffed = armed.filter((timer) => typeof timer?.hasRef !== "function" || timer.hasRef()).length;
  if (reffed) return broken(reffed + " of " + armed.length + " settle deadlines keep the process alive (not unref'd)");
  return held("the dropped write arrived through the deadline as change 8 prev 4 and nothing followed; a deleted file ended silently; " + armed.length + " deadlines, all unref'd; no setInterval in the source or at run");
});
