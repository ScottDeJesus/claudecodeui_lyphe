// protects: server/modules/providers/services/transcript-feed.service.ts
// writes: none
// The transcript feed's ledger: seen() at the first scan publishes nothing; each change carries the size the feed
// knew as previousSize (a same-size change too); an add carries null; an unlink size 0; a change for a path the
// ledger never held is judged by the feed's own lstat, never by the stats it was handed.
import fs from "node:fs";
import path from "node:path";
import { runCase, held, broken } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const FEED = "../../server/modules/providers/services/transcript-feed.service.ts";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type Heard = { kind: string; size: number; previousSize: number | null; provider: string; absolute: boolean };

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  let mod: any;
  try { mod = await import(FEED); } catch (error: any) { return broken("transcript-feed.service.ts would not load: " + String(error?.message ?? error).split("\n")[0]); }
  if (typeof mod.createTranscriptFeed !== "function") return broken("transcript-feed.service.ts exports no createTranscriptFeed");
  const dir: string = await scratchDir(t, "transcript-feed-ledger");
  const errors: string[] = [];
  const heard = new Map<string, Heard[]>();
  const feed = mod.createTranscriptFeed({ settleMs: 60000, lstat: (p: string) => fs.promises.lstat(p), logError: (m: string) => errors.push(m) });
  t.defer(() => feed.close());
  feed.subscribe((e: any) => {
    const name = path.basename(e.filePath);
    const list = heard.get(name) ?? [];
    list.push({ kind: e.kind, size: e.size, previousSize: e.previousSize, provider: e.provider, absolute: path.isAbsolute(e.filePath) });
    heard.set(name, list);
  });
  const file = (name: string, body: string) => { const p = path.join(dir, name); fs.writeFileSync(p, body); return p; };

  const old = file("old.jsonl", "a\n".repeat(10));        // 20 bytes, seen with chokidar's stats
  const quiet = file("quiet.jsonl", "xyz\n");             // 4 bytes, seen with no stats: the feed takes its own lstat
  feed.seen("claude", old, fs.lstatSync(old));
  feed.seen("claude", quiet, undefined);
  await sleep(100);
  if (heard.size) return broken("seen() published: " + JSON.stringify([...heard]));

  fs.appendFileSync(old, "bb\n");                         // 23
  feed.report("change", "claude", old, fs.lstatSync(old));
  feed.report("change", "claude", old, fs.lstatSync(old)); // the size did not move: still published
  fs.appendFileSync(quiet, "q\n");                        // 6
  feed.report("change", "claude", quiet, fs.lstatSync(quiet));
  const fresh = file("fresh.jsonl", "hello\n");           // 6
  feed.report("add", "claude", fresh, fs.lstatSync(fresh));
  fs.unlinkSync(fresh);
  feed.report("unlink", "claude", fresh);
  const unheld = file("unheld.jsonl", "12345");           // 5 bytes, handed the stats of another file
  feed.report("change", "claude", unheld, fs.lstatSync(old));
  await sleep(150);

  const want: Record<string, Array<[string, number, number | null]>> = {
    "old.jsonl": [["change", 23, 20], ["change", 23, 23]],
    "quiet.jsonl": [["change", 6, 4]],
    "fresh.jsonl": [["add", 6, null], ["unlink", 0, -1]],
    "unheld.jsonl": [["change", 5, null]],
  };
  const wrong: string[] = [];
  for (const [name, expected] of Object.entries(want)) {
    const got = heard.get(name) ?? [];
    const shape = got.map((e) => e.kind + " " + e.size + " prev " + e.previousSize).join(", ");
    const ok = got.length === expected.length && expected.every(([kind, size, prev], i) =>
      got[i].kind === kind && got[i].size === size && (prev === -1 || got[i].previousSize === prev) && got[i].provider === "claude" && got[i].absolute);
    if (!ok) wrong.push(name + ": heard [" + shape + "], wanted [" + expected.map(([k, s, p]) => k + " " + s + " prev " + (p === -1 ? "any" : p)).join(", ") + "]");
  }
  if (wrong.length) return broken(wrong.join("; "));
  if (errors.length) return broken("logError was called: " + errors.join(" | "));
  return held("seen() published nothing; old.jsonl change 23 prev 20, then 23 prev 23; quiet.jsonl (seen with no stats) change 6 prev 4; fresh.jsonl add 6 prev null, unlink 0; unheld.jsonl judged by lstat: change 5 prev null");
});
