// protects: server/modules/universe/universe-transcript-tail.ts
// writes: none
// The tail acts only on a .jsonl under root plus the separator, and the event sets where it reads from: a change for a
// file it never held reads from the event's size (nothing old), a shrink moves the offset to the new size, an unlink
// forgets the file and a re-add reads it from 0; stop() unsubscribes once and nothing is read after it. Every file is
// made after start, so nothing but the feed's events can deliver them inside the case's few seconds.
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
  const r: any = await rig(t, "universe-tail-offsets");
  if (typeof r === "string") return broken(r);
  r.tail.start();
  let stopped = false;
  t.defer(() => { if (!stopped) r.tail.stop(); });
  await sleep(300);
  const make = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
  const settle = async (n: number) => { await until(() => r.count() >= n, 3000); await sleep(250); };

  const outside = make(path.join(r.dir, "elsewhere", "x.jsonl"), line("outside"));
  const sibling = make(path.join(r.root + "-other", "proj", "y.jsonl"), line("sibling"));
  const notes = make(path.join(r.project, "notes.txt"), line("notes"));
  for (const f of [outside, sibling, notes]) r.report("add", f);

  const unheld = make(path.join(r.project, "unheld.jsonl"), line("u-0"));
  r.report("change", unheld);
  const shrink = make(path.join(r.project, "shrink.jsonl"), line("s-1") + line("s-2") + line("s-3"));
  r.report("add", shrink);
  const readd = make(path.join(r.project, "readd.jsonl"), line("r-1"));
  r.report("add", readd);
  await settle(4);

  fs.appendFileSync(unheld, line("u-1"));
  r.report("change", unheld);
  fs.truncateSync(shrink, (line("s-1") + line("s-2")).length);
  r.report("change", shrink);
  fs.unlinkSync(readd);
  r.report("unlink", readd);
  await sleep(300);
  fs.appendFileSync(shrink, line("s-4"));
  r.report("change", shrink);
  make(readd, line("r-1") + line("r-2"));
  r.report("add", readd);
  await settle(8);

  r.tail.stop();
  stopped = true;
  fs.appendFileSync(shrink, line("s-5"));
  r.report("change", shrink);
  await sleep(500);

  const body = (n: string) => line(n).trim();
  const want: Record<string, string[]> = {
    [path.relative(r.root, unheld)]: [body("u-1")],
    [path.relative(r.root, shrink)]: [body("s-1"), body("s-2"), body("s-3"), body("s-4")],
    [path.relative(r.root, readd)]: [body("r-1"), body("r-1"), body("r-2")],
  };
  const got = Object.fromEntries(r.heard);
  const keys = new Set([...Object.keys(want), ...Object.keys(got)]);
  const wrong = [...keys].filter((k) => JSON.stringify(got[k] ?? []) !== JSON.stringify(want[k] ?? []))
    .map((k) => k + ": heard " + JSON.stringify(got[k] ?? []) + ", wanted " + JSON.stringify(want[k] ?? []));
  if (wrong.length) return broken(wrong.join("; ").slice(0, 380));
  if (r.subscription.subscribed !== 1 || r.subscription.unsubscribed !== 1) return broken("start/stop subscribed " + r.subscription.subscribed + " and unsubscribed " + r.subscription.unsubscribed + " times, wanted 1 and 1");
  if (r.errors.length) return broken("logError was called: " + r.errors.join(" | ").slice(0, 300));
  return held("outside root, the root-prefixed sibling and notes.txt never read; unheld gave u-1 only; shrink s-1..s-4; readd r-1 then r-1, r-2; one subscribe, one unsubscribe, nothing after stop");
});
