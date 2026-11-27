// protects: server/modules/cli-version/cli-version-watch.ts, server/modules/cli-version/cli-version.module.ts, server/shared/file-lane.service.ts, server/shared/paced-hint.service.ts, server/shared/directory-watch.service.ts
// writes: none
// The installed CLI's version is told by a watch on its binary, not by a 60 s clock: startCliVersionWatch watches the
// directory of the path a run spawns (an installer repoints the link there) and the directory of its real file (an
// in-place upgrade rewrites it there), runs probe on an event paced to one per two seconds, and after each probe
// resolves the two files again, because an upgrade can move the real file. The binary is a scratch link into scratch
// version directories; probe only counts. A watch that does not reopen after a move, hears a file it does not name,
// keeps listening on the old file or after stop(), reads BROKEN.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const GAP_MS = 2_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const dir: string = await scratchDir(t, "cli-version-watch");
  const bin = path.join(dir, "bin");
  const v1 = path.join(dir, "versions", "1.0.0");
  const v2 = path.join(dir, "versions", "2.0.0");
  for (const d of [bin, v1, v2]) fs.mkdirSync(d, { recursive: true });
  const real1 = path.join(v1, "cli.js");
  const real2 = path.join(v2, "cli.js");
  fs.writeFileSync(real1, "// 1.0.0\n");
  fs.writeFileSync(real2, "// 2.0.0\n");
  const link = path.join(bin, "claude");
  fs.symlinkSync(real1, link);

  const probes: number[] = [];
  const errors: string[] = [];
  const mod: any = await import("../../server/modules/cli-version/cli-version-watch.ts");
  const watch = mod.startCliVersionWatch({
    binaryPath: () => link,
    probe: async () => { probes.push(Date.now()); },
    logError: (message: string) => errors.push(message),
  });
  let stopped = false;
  t.defer(() => { if (!stopped) watch.stop(); });
  const watching = (): string[] | null => (typeof watch.watching === "function" ? [...watch.watching()] : null);
  const waitFor = async (count: number, ms: number) => {
    const until = Date.now() + ms;
    while (probes.length < count && Date.now() < until) await sleep(25);
    return probes.length >= count;
  };
  await sleep(300);

  const armed = watching();
  if (armed !== null) {
    const want = [link, fs.realpathSync(real1)];
    if (JSON.stringify(armed) !== JSON.stringify(want)) return broken("armed on " + JSON.stringify(armed) + ", not the link and its real file " + JSON.stringify(want));
  }

  fs.writeFileSync(path.join(bin, "other"), "x");
  fs.writeFileSync(path.join(v1, "README"), "x");
  await sleep(800);
  if (probes.length > 0) return broken("a write to a file the watch does not name ran " + probes.length + " probe(s)");

  const t0 = Date.now();
  fs.appendFileSync(real1, "// write 1\n");
  if (!(await waitFor(1, 1000))) return broken("no probe within a second of a write to the link's real file");
  const firstMs = probes[0] - t0;
  for (let i = 2; i <= 4; i += 1) { await sleep(300); fs.appendFileSync(real1, "// write " + i + "\n"); }
  await sleep(Math.max(0, t0 + 1500 - Date.now()));
  if (probes.length !== 1) return broken("a burst inside the two-second gap ran " + (probes.length - 1) + " more probe(s) by 1.5 s");
  await sleep(Math.max(0, t0 + GAP_MS + 1500 - Date.now()));
  if (probes.length !== 2) return broken("by 3.5 s the burst had run " + (probes.length - 1) + " trailing probe(s), not 1");

  // An installer's move: a new link renamed over the old one, into another version's directory.
  await sleep(GAP_MS + 200);
  const beforeMove = probes.length;
  const tmpLink = path.join(bin, ".claude.new");
  fs.symlinkSync(real2, tmpLink);
  fs.renameSync(tmpLink, link);
  if (!(await waitFor(beforeMove + 1, 1500))) return broken("repointing the link by rename ran no probe");
  await sleep(300);
  const moved = watching();
  if (moved !== null) {
    const want = [link, fs.realpathSync(real2)];
    if (JSON.stringify(moved) !== JSON.stringify(want)) return broken("after the repoint the watch is on " + JSON.stringify(moved) + ", not " + JSON.stringify(want));
  }
  await sleep(GAP_MS + 200);
  const beforeNew = probes.length;
  fs.appendFileSync(real2, "// a write on the new real file\n");
  if (!(await waitFor(beforeNew + 1, 1500))) return broken("after the link moved, a write to its new real file ran no probe: the lanes were not reopened");
  await sleep(GAP_MS + 200);
  const beforeOld = probes.length;
  fs.appendFileSync(real1, "// a write on the old real file\n");
  await sleep(1200);
  if (probes.length !== beforeOld) return broken("a write to the old real file still ran a probe after the link moved away from it");

  watch.stop();
  stopped = true;
  await sleep(GAP_MS + 200);
  const beforeStop = probes.length;
  fs.appendFileSync(real2, "// after stop\n");
  await sleep(1200);
  if (probes.length !== beforeStop) return broken("a write after stop() ran a probe");
  if (errors.length > 0) return broken("the watch logged: " + errors.join("; "));
  return held("first probe " + firstMs + " ms after the write; one trailing probe for the burst; the repoint probed and the new file's write probed; the old file, an unnamed file and a write after stop() ran none" + (armed === null ? " (no watching() to print)" : "; armed on both directories, then on the moved one"));
});
