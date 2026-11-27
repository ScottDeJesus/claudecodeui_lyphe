// protects: server/modules/universe/universe-transcript-tail.ts, server/modules/providers/services/transcript-feed.service.ts
// writes: none
// The universe transcript tail on the transcript feed: a transcript the feed saw at its first scan is read from where its
// new writing starts (the appended line only), a file added after start from 0 (every line), a line written in two halves
// once and whole, and <sid>/subagents/agent-1.jsonl like any other transcript. The old file's mtime is an hour old and the
// rest are made after start, so nothing but the feed's events can deliver them inside the case's few seconds.
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
  const r: any = await rig(t, "universe-tail-feed");
  if (typeof r === "string") return broken(r);
  const sid = "6a1b2c3d-0000-4000-8000-00000000c0de";
  fs.mkdirSync(path.join(r.project, sid, "subagents"), { recursive: true });
  const old = path.join(r.project, "old.jsonl");
  fs.writeFileSync(old, line("old-1") + line("old-2"));
  const hourAgo = new Date(Date.now() - 3600000);
  fs.utimesSync(old, hourAgo, hourAgo);
  r.feed.seen("claude", old, fs.lstatSync(old));
  r.tail.start();
  t.defer(() => r.tail.stop());
  await sleep(300);

  fs.appendFileSync(old, line("old-3"));
  r.report("change", old);
  const fresh = path.join(r.project, "fresh.jsonl");
  fs.writeFileSync(fresh, line("fresh-1") + line("fresh-2") + line("fresh-3"));
  r.report("add", fresh);
  const agent = path.join(r.project, sid, "subagents", "agent-1.jsonl");
  fs.writeFileSync(agent, line("agent-1") + line("agent-2"));
  r.report("add", agent);
  const halves = path.join(r.project, "halves.jsonl");
  const whole = line("half-and-half");
  fs.writeFileSync(halves, whole.slice(0, 9));
  r.report("add", halves);
  await until(() => r.count() >= 6, 3000);
  await sleep(300);
  fs.appendFileSync(halves, whole.slice(9));
  r.report("change", halves);
  await until(() => r.count() >= 7, 3000);
  await sleep(400);

  const body = (n: string) => line(n).trim();
  const want: Record<string, string[]> = {
    [path.relative(r.root, old)]: [body("old-3")],
    [path.relative(r.root, fresh)]: [body("fresh-1"), body("fresh-2"), body("fresh-3")],
    [path.relative(r.root, agent)]: [body("agent-1"), body("agent-2")],
    [path.relative(r.root, halves)]: [body("half-and-half")],
  };
  const got = Object.fromEntries(r.heard);
  const keys = new Set([...Object.keys(want), ...Object.keys(got)]);
  const wrong = [...keys].filter((k) => JSON.stringify(got[k] ?? []) !== JSON.stringify(want[k] ?? []))
    .map((k) => k + ": heard " + JSON.stringify(got[k] ?? []) + ", wanted " + JSON.stringify(want[k] ?? []));
  if (wrong.length) return broken(wrong.join("; ").slice(0, 380));
  if (r.errors.length) return broken("logError was called: " + r.errors.join(" | ").slice(0, 300));
  return held("old.jsonl gave only old-3; fresh.jsonl fresh-1..3; subagents/agent-1.jsonl agent-1, agent-2; the split line once, whole; no logError");
});
