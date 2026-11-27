// protects: server/modules/universe/universe-transcript-tail.ts
// writes: none
// The tail reads window after window (4 MB each) until the offset reaches the size the latest event reported: a 10.5 MB
// transcript added after start and 1,000 more lines appended and reported right after give every numbered line once, in order.
import fs from "node:fs";
import path from "node:path";
import { runCase, held, broken } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const TAIL = "../../server/modules/universe/universe-transcript-tail.ts";
const FEED = "../../server/modules/providers/services/transcript-feed.service.ts";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(ok: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (ok()) return true; await sleep(25); }
  return ok();
}
const firstLine = (error: any) => String(error?.message ?? error).split("\n")[0];
const line = (n: string | number, pad = "") => JSON.stringify(pad ? { n, pad } : { n }) + "\n";

/** The real tail over a real feed on a scratch root, driven the way the sessions watcher drives the feed. */
async function rig(t: { defer: (cleanup: () => unknown) => void }, label: string) {
  let tailMod: any; let feedMod: any;
  try { tailMod = await import(TAIL); } catch (error) { return "universe-transcript-tail.ts would not load: " + firstLine(error); }
  try { feedMod = await import(FEED); } catch (error) { return "transcript-feed.service.ts would not load: " + firstLine(error); }
  if (typeof tailMod.createTranscriptTail !== "function") return "universe-transcript-tail.ts exports no createTranscriptTail";
  if (typeof feedMod.createTranscriptFeed !== "function") return "transcript-feed.service.ts exports no createTranscriptFeed";
  const dir: string = await scratchDir(t, label);
  const root = path.join(dir, "projects");
  const project = path.join(root, "-home-case-proj");
  fs.mkdirSync(project, { recursive: true });
  const errors: string[] = [];
  const heard = new Map<string, string[]>();
  const feed = feedMod.createTranscriptFeed({ settleMs: 60000, lstat: (p: string) => fs.promises.lstat(p), logError: (m: string) => errors.push("feed: " + m) });
  t.defer(() => feed.close());
  const subscription = { subscribed: 0, unsubscribed: 0 };
  const tail = tailMod.createTranscriptTail({
    root,
    subscribe: (listener: any) => {
      subscription.subscribed += 1;
      const off = feed.subscribe(listener);
      return () => { subscription.unsubscribed += 1; off(); };
    },
    onLine: (file: string, body: string) => { const key = path.relative(root, file); heard.set(key, [...(heard.get(key) ?? []), body]); },
    logError: (m: string) => errors.push("tail: " + m),
  });
  const report = (kind: string, file: string) => feed.report(kind, "claude", file, kind === "unlink" ? undefined : fs.lstatSync(file));
  const count = () => [...heard.values()].reduce((n, list) => n + list.length, 0);
  return { dir, root, project, feed, tail, heard, errors, subscription, report, count };
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const r: any = await rig(t, "universe-tail-windows");
  if (typeof r === "string") return broken(r);
  const numbers: number[] = [];
  r.tail.start();
  t.defer(() => r.tail.stop());
  await sleep(300);
  const pad = "x".repeat(980);
  const big = path.join(r.project, "big.jsonl");
  let text = "";
  for (let i = 1; i <= 10500; i++) text += line(i, pad);
  fs.writeFileSync(big, text);
  r.report("add", big);
  let more = "";
  for (let i = 10501; i <= 11500; i++) more += line(i, pad);
  fs.appendFileSync(big, more);
  r.report("change", big);
  await until(() => r.count() >= 11500, 10000);
  await sleep(400);
  for (const body of r.heard.get(path.relative(r.root, big)) ?? []) {
    try { numbers.push(JSON.parse(body).n); } catch { numbers.push(-1); }
  }
  const outOfPlace = numbers.findIndex((n, i) => n !== i + 1);
  if (numbers.length !== 11500 || outOfPlace !== -1) {
    return broken("heard " + numbers.length + " lines of 11500 (" + fs.statSync(big).size + " bytes)" + (outOfPlace === -1 ? "" : "; line " + (outOfPlace + 1) + " was n=" + numbers[outOfPlace]));
  }
  if (r.heard.size !== 1) return broken("lines from another file: " + [...r.heard.keys()].join(", "));
  if (r.errors.length) return broken("logError was called: " + r.errors.join(" | ").slice(0, 300));
  return held("all 11500 numbered lines of a " + fs.statSync(big).size + "-byte transcript once and in order; no logError");
});
