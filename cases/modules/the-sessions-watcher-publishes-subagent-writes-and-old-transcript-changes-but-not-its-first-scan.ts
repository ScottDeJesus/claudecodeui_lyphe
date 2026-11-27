// protects: server/modules/providers/services/sessions-watcher.service.ts, server/modules/providers/services/transcript-feed.service.ts, server/modules/providers/index.ts
// writes: none
// The real sessions watcher over a scratch HOME publishes to the feed's door in the providers barrel: a change of a
// transcript that was there at boot carries its first-scan size, a file under subagents/ is heard, and nothing is
// published for the first scan, for tool-results/, or after closeSessionsWatcher.
import fs from "node:fs";
import path from "node:path";
import { runCase, held, broken } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const WATCHER = "../../server/modules/providers/services/sessions-watcher.service.ts";
const PROVIDERS = "../../server/modules/providers/index.ts";
const DATABASE = "../../server/modules/database/index.ts";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (check()) return true; await sleep(50); }
  return check();
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const dir: string = await scratchDir(t, "sessions-watcher-feed");
  const home = path.join(dir, "home");
  const project = path.join(home, ".claude", "projects", "-tmp-athena-feed");
  const sid = "aaaaaaaa-0000-4000-8000-00000000f33d";
  const old = path.join(project, sid + ".jsonl");
  const seenAgent = path.join(project, sid, "subagents", "agent-0.jsonl");
  const lateAgent = path.join(project, sid, "subagents", "agent-1.jsonl");
  const toolResult = path.join(project, sid, "tool-results", "late.jsonl");
  fs.mkdirSync(path.dirname(seenAgent), { recursive: true });
  fs.mkdirSync(path.dirname(toolResult), { recursive: true });
  fs.writeFileSync(old, '{"type":"note","n":1}\n');
  fs.writeFileSync(seenAgent, '{"type":"note","n":0}\n');
  const oldSize = fs.statSync(old).size;

  const realHome = process.env.HOME;
  process.env.HOME = home;                                 // read by the watcher's roots when its module loads
  process.env.DATABASE_PATH = path.join(dir, "auth.db");
  t.defer(() => { if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome; });

  const database: any = await import(DATABASE);
  await database.initializeDatabase();
  const providers: any = await import(PROVIDERS);
  if (typeof providers.subscribeTranscriptFeed !== "function") return broken("server/modules/providers/index.ts exports no subscribeTranscriptFeed");
  const watcher: any = await import(WATCHER);
  const events: Array<{ kind: string; file: string; size: number; previousSize: number | null; provider: string }> = [];
  const unsubscribe = providers.subscribeTranscriptFeed((e: any) => events.push({ kind: e.kind, file: path.relative(project, e.filePath), size: e.size, previousSize: e.previousSize, provider: e.provider }));
  t.defer(unsubscribe);
  let closed = false;
  t.defer(async () => { if (!closed) await watcher.closeSessionsWatcher(); });
  await watcher.initializeSessionsWatcher();

  // Ready: an add after chokidar's 'ready' is published, one before it only seen.
  let written = 0;
  let ready = false;
  const readyBy = Date.now() + 20000;
  while (!ready && Date.now() < readyBy) {
    fs.writeFileSync(path.join(project, "ready-" + written++ + ".jsonl"), "");
    ready = await until(() => events.some((e) => e.kind === "add" && e.file.startsWith("ready-")), 300);
  }
  if (!ready) return broken("no add reached subscribeTranscriptFeed for a transcript created after the watcher started (" + written + " written over 20 s); heard " + JSON.stringify(events).slice(0, 200));
  const firstScan = events.filter((e) => e.file === path.basename(old) || e.file.includes("agent-0"));
  if (firstScan.length) return broken("the first scan was published: " + JSON.stringify(firstScan));

  const mark = events.length;
  fs.appendFileSync(old, '{"type":"note","n":2}\n');
  const grown = fs.statSync(old).size;
  fs.writeFileSync(lateAgent, '{"type":"note","n":1}\n');
  fs.writeFileSync(toolResult, '{"type":"note","n":1}\n');
  const agentRel = path.relative(project, lateAgent);
  await until(() => events.slice(mark).some((e) => e.file === path.basename(old) && e.kind === "change") && events.slice(mark).some((e) => e.file === agentRel), 8000);
  await sleep(1000);
  const after = events.slice(mark);
  const oldChange = after.find((e) => e.file === path.basename(old) && e.kind === "change");
  if (!oldChange) return broken("no change of the boot-time transcript was heard after it was appended to; heard " + JSON.stringify(after));
  if (oldChange.previousSize !== oldSize || oldChange.size !== grown || oldChange.provider !== "claude") return broken("the boot-time transcript's change was " + JSON.stringify(oldChange) + ", wanted claude size " + grown + " previousSize " + oldSize);
  const agentAdd = after.find((e) => e.file === agentRel && e.kind === "add");
  if (!agentAdd) return broken("nothing was heard for " + agentRel + " (subagents still ignored?); heard " + JSON.stringify(after));
  if (agentAdd.previousSize !== null) return broken("the subagent file's add carried previousSize " + agentAdd.previousSize);
  const tool = after.filter((e) => e.file.includes("tool-results"));
  if (tool.length) return broken("tool-results was published: " + JSON.stringify(tool));

  await watcher.closeSessionsWatcher();
  closed = true;
  const mark2 = events.length;
  fs.appendFileSync(old, '{"type":"note","n":3}\n');
  await sleep(1200);
  if (events.length > mark2) return broken("after closeSessionsWatcher the feed still published " + JSON.stringify(events.slice(mark2)));
  return held("boot-time transcript change " + oldSize + " -> " + grown + " carried previousSize " + oldSize + "; " + agentRel + " heard as add; nothing for the first scan, tool-results or after close");
});
