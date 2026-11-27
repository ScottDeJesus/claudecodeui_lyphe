// protects: server/modules/providers/services/transcript-feed.service.ts
// writes: none
// A *.jsonl symlink is never admitted, whatever stats it is handed; listeners hear in subscription order and a throwing
// one is named through logError without reaching report() or the next listener; close() clears every deadline and the
// ledger.
import fs from "node:fs";
import path from "node:path";
import { runCase, held, broken } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const FEED = "../../server/modules/providers/services/transcript-feed.service.ts";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  let mod: any;
  try { mod = await import(FEED); } catch (error: any) { return broken("transcript-feed.service.ts would not load: " + String(error?.message ?? error).split("\n")[0]); }
  if (typeof mod.createTranscriptFeed !== "function") return broken("transcript-feed.service.ts exports no createTranscriptFeed");
  const dir: string = await scratchDir(t, "transcript-feed-symlink");
  const outside = path.join(dir, "outside");
  const root = path.join(dir, "root");
  fs.mkdirSync(outside);
  fs.mkdirSync(root);
  const target = path.join(outside, "secret.jsonl");
  fs.writeFileSync(target, "secret\n");
  const link = path.join(root, "link.jsonl");
  fs.symlinkSync(target, link);

  const errors: string[] = [];
  const order: string[] = [];
  const events: Array<{ kind: string; name: string; size: number; previousSize: number | null }> = [];
  const feed = mod.createTranscriptFeed({ settleMs: 100, lstat: (p: string) => fs.promises.lstat(p), logError: (m: string) => errors.push(m) });
  t.defer(() => feed.close());
  feed.subscribe((e: any) => { events.push({ kind: e.kind, name: path.basename(e.filePath), size: e.size, previousSize: e.previousSize }); order.push("first " + path.basename(e.filePath)); });
  feed.subscribe(() => { throw new Error("listener-boom"); });
  feed.subscribe((e: any) => { order.push("third " + path.basename(e.filePath)); });

  feed.seen("claude", link, fs.lstatSync(link));
  feed.seen("claude", link, undefined);
  feed.report("add", "claude", link, fs.lstatSync(link));
  feed.report("add", "claude", link, undefined);
  feed.report("change", "claude", link, fs.statSync(link)); // stats that followed the link: the feed must lstat it itself
  await sleep(300);
  const linkHeard = events.filter((e) => e.name === "link.jsonl");
  if (linkHeard.length) return broken("a symlink was published: " + JSON.stringify(linkHeard));
  if (errors.length) return broken("logError before any listener threw: " + errors.join(" | "));

  const real = path.join(root, "real.jsonl");
  fs.writeFileSync(real, "a\n");
  let threw = "";
  try { feed.report("add", "claude", real, fs.lstatSync(real)); } catch (error: any) { threw = String(error?.message ?? error); }
  await sleep(20);
  if (threw) return broken("report() threw a listener's error: " + threw);
  if (order.join(",") !== "first real.jsonl,third real.jsonl") return broken("listeners heard " + JSON.stringify(order) + ", wanted the first then the third");
  if (errors.length !== 1 || !errors[0].includes("listener-boom")) return broken("logError heard " + JSON.stringify(errors) + ", wanted one line naming listener-boom");

  fs.appendFileSync(real, "b\n");                          // 4 bytes, inside the armed deadline
  feed.close();
  await sleep(350);
  const afterClose = events.filter((e) => e.name === "real.jsonl").slice(1);
  if (afterClose.length) return broken("after close() a deadline still published: " + JSON.stringify(afterClose));
  feed.report("change", "claude", real, fs.lstatSync(real));
  await sleep(100);
  const next = events.filter((e) => e.name === "real.jsonl").slice(1);
  if (next.length !== 1 || next[0].kind !== "change" || next[0].size !== 4 || next[0].previousSize !== null) return broken("the first change after close() was " + JSON.stringify(next) + ", wanted one change 4 with previousSize null (the ledger cleared)");
  return held("the symlink was never published (seen, add with and without stats, change with followed stats); listeners heard first then third, the throw named once through logError; after close() no deadline fired and the next change carried previousSize null");
});
