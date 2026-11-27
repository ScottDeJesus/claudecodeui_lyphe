// protects: server/modules/universe/universe-transcript-tail.ts
// writes: none
// The tail is told, never ticking (pollers-hooks--sessions-watcher, phase 3). The real tail over a scratch root holding a
// transcript and a subagents transcript written a moment ago, with a subscribe that hands it no event: while both files grow
// for two seconds it reads no line at all (a walk or a poll would: both files are fresh and the corpus is two files). Then one
// change event for the first file, carrying the size it grew to and the size it had before, reads exactly the lines appended
// to it, once each and in order, and nothing of the other file. stop() unsubscribes once; logError is never called.
import fs from "node:fs";
import path from "node:path";
import { runCase, held, broken } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const TAIL = "../../server/modules/universe/universe-transcript-tail.ts";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(ok: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (ok()) return true; await sleep(25); }
  return ok();
}
const firstLine = (error: any) => String(error?.message ?? error).split("\n")[0];
const line = (n: string) => JSON.stringify({ n }) + "\n";

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  let mod: any;
  try { mod = await import(TAIL); } catch (error) { return broken("universe-transcript-tail.ts would not load: " + firstLine(error)); }
  if (typeof mod.createTranscriptTail !== "function") return broken("universe-transcript-tail.ts exports no createTranscriptTail");
  const dir: string = await scratchDir(t, "universe-tail-told-nothing");
  const root = path.join(dir, "projects");
  const project = path.join(root, "-home-case-proj");
  fs.mkdirSync(path.join(project, "sid-1", "subagents"), { recursive: true });
  const live = path.join(project, "live.jsonl");
  const agent = path.join(project, "sid-1", "subagents", "agent-1.jsonl");
  fs.writeFileSync(live, line("before-1") + line("before-2"));
  fs.writeFileSync(agent, line("agent-before"));
  const before = fs.statSync(live).size;

  const heard: string[] = [];
  const errors: string[] = [];
  let listener: ((event: any) => void) | null = null;
  let subscribed = 0;
  let unsubscribed = 0;
  const tail = mod.createTranscriptTail({
    root,
    subscribe: (handed: (event: any) => void) => {
      subscribed += 1;
      listener = handed;
      return () => { unsubscribed += 1; listener = null; };
    },
    onLine: (file: string, body: string) => heard.push(path.relative(root, file) + " " + body),
    logError: (message: string) => errors.push(message),
  });
  let stopped = false;
  t.defer(() => { if (!stopped) tail.stop(); });
  tail.start();
  await sleep(500);
  for (let i = 1; i <= 4; i += 1) {
    fs.appendFileSync(live, line("after-" + i));
    fs.appendFileSync(agent, line("agent-after-" + i));
    await sleep(400);
  }
  await sleep(1200);
  if (subscribed !== 1 || listener === null) return broken("start() subscribed " + subscribed + " time(s) and holds no listener");
  if (heard.length) return broken("told nothing by the feed, the tail still read " + heard.length + " line(s) on its own (a walk or a poll stands): " + heard.slice(0, 4).join(" | "));

  const size = fs.statSync(live).size;
  (listener as (event: any) => void)({ provider: "claude", kind: "change", filePath: live, size, previousSize: before });
  await until(() => heard.length >= 4, 3000);
  await sleep(400);
  tail.stop();
  stopped = true;
  const want = [1, 2, 3, 4].map((i) => path.relative(root, live) + " " + line("after-" + i).trim());
  if (JSON.stringify(heard) !== JSON.stringify(want)) return broken("after one change event the tail heard " + JSON.stringify(heard).slice(0, 300) + ", wanted the four appended lines of live.jsonl");
  if (unsubscribed !== 1) return broken("stop() unsubscribed " + unsubscribed + " time(s)");
  if (errors.length) return broken("logError was called: " + errors.join(" | ").slice(0, 300));
  return held("told nothing, the tail read nothing while two fresh transcripts grew for 2 s; one change event read after-1..4 of live.jsonl from previousSize, once each; stop() unsubscribed once; no logError");
});
