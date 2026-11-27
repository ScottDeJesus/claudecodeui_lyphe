// protects: deploy/tree-watch/tree-watch.mjs, deploy/dev-supervisor/watch.mjs
// writes: none
//
// watchTree settles a burst once. With maxWaitMs left out (the dev supervisor's call) onChange fires settleMs after the
// burst's last event and never during it, with the path relative to the root; with maxWaitMs a number, a stream of edits
// that never goes quiet still settles, each time no later than maxWaitMs after that burst's first event. On a scratch tree.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const TREE_WATCH = new URL("../../deploy/tree-watch/tree-watch.mjs", import.meta.url);
const EDIT_EVERY_MS = 250;
const SLACK_MS = 400;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Edits one file every EDIT_EVERY_MS for forMs, so the burst never goes quiet; answers its first and last edit. */
async function stream(file, forMs) {
  const first = Date.now();
  let last = first;
  while (Date.now() - first < forMs) {
    fs.writeFileSync(file, String(Date.now()));
    last = Date.now();
    await sleep(EDIT_EVERY_MS);
  }
  return { first, last };
}

/** Watches root with the options given while a stream of edits runs, then settles; answers the stream and each settle. */
async function watchWhileEditing(watchTree, root, file, options, forMs) {
  const settled = [];
  const close = watchTree(root, { ...options, onChange: (p) => settled.push({ at: Date.now(), p }), log: () => {} });
  try {
    await sleep(200);
    const edits = await stream(file, forMs);
    await sleep(options.settleMs + SLACK_MS * 2);
    return { edits, settled };
  } finally {
    close();
  }
}

runCase(async (t) => {
  let watchTree;
  try {
    ({ watchTree } = await import(TREE_WATCH.href));
  } catch (error) {
    return broken("deploy/tree-watch/tree-watch.mjs would not load: " + String(error.message).split("\n")[0]);
  }
  if (typeof watchTree !== "function") return broken("deploy/tree-watch/tree-watch.mjs exports no watchTree");
  const root = await scratchDir(t, "tree-watch");
  fs.mkdirSync(path.join(root, "deep", "er"), { recursive: true });
  const file = path.join(root, "deep", "er", "edited.txt");
  const isWatched = (relativePath) => relativePath.endsWith(".txt");

  const a = await watchWhileEditing(watchTree, root, file, { isWatched, settleMs: 800 }, 2500);
  if (a.settled.length !== 1) return broken("with no maxWaitMs, 2.5 s of edits 250 ms apart settled " + a.settled.length + " times, not once");
  const lagA = a.settled[0].at - a.edits.last;
  if (lagA < 750 || lagA > 800 + SLACK_MS) return broken("with no maxWaitMs the burst settled " + lagA + " ms after its last edit, not settleMs 800 after it");
  if (a.settled[0].p !== path.join("deep", "er", "edited.txt")) return broken("onChange was handed " + JSON.stringify(a.settled[0].p) + ", not deep/er/edited.txt");

  const b = await watchWhileEditing(watchTree, root, file, { isWatched, settleMs: 1000, maxWaitMs: 1500 }, 4000);
  const during = b.settled.filter((s) => s.at <= b.edits.last);
  if (during.length < 2) return broken("with maxWaitMs 1500, 4 s of edits that never went 1 s quiet settled " + during.length + " times while they ran, not at least twice");
  const firstLag = b.settled[0].at - b.edits.first;
  if (firstLag > 1500 + SLACK_MS) return broken("with maxWaitMs 1500 the first settle came " + firstLag + " ms after the burst's first edit");
  for (let i = 1; i < b.settled.length; i += 1) {
    const gap = b.settled[i].at - b.settled[i - 1].at;
    if (gap > 1500 + EDIT_EVERY_MS + SLACK_MS) return broken("with maxWaitMs 1500 two settles of an unbroken stream were " + gap + " ms apart");
  }
  return held("no maxWaitMs: one settle " + lagA + " ms after the last edit; maxWaitMs 1500: " + b.settled.length + " settles, the first " + firstLag + " ms after the first edit, " + during.length + " while the edits ran");
});
