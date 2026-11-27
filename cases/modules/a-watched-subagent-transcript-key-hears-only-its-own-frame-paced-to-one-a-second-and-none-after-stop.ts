// protects: server/modules/providers/services/subagent-transcript-watch.service.ts, server/modules/websocket/services/lane-watch.service.ts, server/shared/file-lane.service.ts, server/shared/paced-hint.service.ts, server/shared/directory-watch.service.ts
// writes: none
//
// An open subagent transcript view is told, not ticked: the server watches the directory the transcript route reads for
// the view's key and sends { kind: 'subagent_transcript_changed', at, key } only to the sockets watching that key, at most
// one a second per key. A write to a name the route does not read says nothing; once the key's last watcher stops,
// nothing more is sent, while a key of another directory still hears its own writes. The keys are soul keys over two
// scratch record directories (the lane's real resolver for an agent key needs a chat on disk); the sockets are
// stand-ins in the real lane registry, dropped when the case ends.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const WATCH = "../../server/modules/providers/services/subagent-transcript-watch.service.ts";
const LANE_WATCH = "../../server/modules/websocket/services/lane-watch.service.ts";
const LANE = "subagent_transcript";
const MINE = "soul:case-mine";
const THEIRS = "soul:case-theirs";
const GAP_MS = 1_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Heard = { frame: any; at: number };

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const root: string = await scratchDir(t, "subagent-transcript-tail");
  const mine = path.join(root, "mine");
  const theirs = path.join(root, "theirs");
  for (const dir of [mine, theirs]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "child.log"), "seed\n");
  }
  process.env.DATABASE_PATH = path.join(root, "auth.db");

  const { laneWatch }: any = await import(LANE_WATCH);
  const { defineSubagentTranscriptWatch }: any = await import(WATCH);
  defineSubagentTranscriptWatch({
    soulRecordDirectory: (id: string) => (id === "case-mine" ? mine : id === "case-theirs" ? theirs : null),
  });
  const stub = () => {
    const heard: Heard[] = [];
    return {
      heard,
      readyState: 1,
      send: (text: string) => {
        let frame: any = text;
        try { frame = JSON.parse(text); } catch { /* kept as text: the shape check names it */ }
        heard.push({ frame, at: Date.now() });
      },
    };
  };
  const a = stub();
  const c = stub();
  const b = stub();
  t.defer(() => { for (const s of [a, b, c]) laneWatch.drop(s); });
  const watch = (s: object, type: string, key: string) => laneWatch.handle(s, { type, lane: LANE, key });
  const append = (dir: string, name: string) => fs.appendFileSync(path.join(dir, name), "line " + Date.now() + "\n");
  const waitFor = async (s: { heard: Heard[] }, n: number, ms: number) => {
    const end = Date.now() + ms;
    while (s.heard.length < n && Date.now() < end) await sleep(25);
    return s.heard.length >= n;
  };

  watch(a, "watch.start", MINE);
  watch(c, "watch.start", MINE);
  watch(b, "watch.start", THEIRS);
  await sleep(1500);
  for (const s of [a, b, c]) s.heard.length = 0;

  append(mine, "notes.txt");
  await sleep(1200);
  if (a.heard.length + c.heard.length > 0) return broken("a write to notes.txt, a name the soul transcript route does not read, sent " + (a.heard.length + c.heard.length) + " frames");

  const t0 = Date.now();
  append(mine, "child.log");
  if (!(await waitFor(a, 1, 1500))) return broken("no subagent_transcript_changed within 1.5 s of a write to child.log under a watched soul key");
  await waitFor(c, 1, 300);
  if (c.heard.length !== 1) return broken("the second socket on the same key heard " + c.heard.length + " frames, not 1");
  const first = a.heard[0];
  const keys = first.frame && typeof first.frame === "object" ? Object.keys(first.frame).sort().join(",") : "";
  if (keys !== "at,key,kind" || first.frame.kind !== "subagent_transcript_changed" || first.frame.key !== MINE || typeof first.frame.at !== "number") {
    return broken("the frame is not exactly { kind: 'subagent_transcript_changed', at, key: '" + MINE + "' }: " + JSON.stringify(first.frame));
  }
  const firstAfter = first.at - t0;

  for (let i = 0; i < 10; i += 1) { await sleep(200); append(mine, "child.log"); }
  await sleep(1300);
  if (a.heard.length < 2) return broken("a two-second burst of writes after the first frame sent no further frame");
  const ats = a.heard.map((h) => h.frame.at as number);
  for (let i = 1; i < ats.length; i += 1) {
    if (ats[i] - ats[i - 1] < GAP_MS - 50) return broken("two frames of one key came " + (ats[i] - ats[i - 1]) + " ms apart, inside the one-second gap");
  }
  if (a.heard.length > 5) return broken("a burst of about 3.3 s sent " + a.heard.length + " frames to one socket");
  if (b.heard.length !== 0) return broken("the socket watching another key heard " + b.heard.length + " frames from writes it does not watch");

  watch(a, "watch.stop", MINE);
  watch(c, "watch.stop", MINE);
  const aAt = a.heard.length;
  const cAt = c.heard.length;
  append(mine, "child.log");
  append(theirs, "child.log");
  await waitFor(b, 1, 1500);
  await sleep(1200);
  if (a.heard.length !== aAt || c.heard.length !== cAt) return broken("after the key's last watch.stop a write still sent frames (" + (a.heard.length - aAt) + " and " + (c.heard.length - cAt) + ")");
  if (b.heard.length !== 1 || b.heard[0].frame?.key !== THEIRS) return broken("the other key, still watched, did not hear its own write once: " + JSON.stringify(b.heard.map((h) => h.frame)));
  return held("unread name: nothing; first frame " + firstAfter + " ms after the write, to both watchers; the burst " + (ats.length - 1) + " more, spaced " + ats.slice(1).map((x, i) => x - ats[i]).join("/") + " ms; nothing after stop; the other key heard its own write once");
});
