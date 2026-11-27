// The Claude update pipeline's two writers speak: writeJob and writeStoredCheck each announce exactly once
// through onUpdateFileWritten, and at that instant the file is whole on disk under its own name (its JSON
// parses to what was written, no temp file beside it). The module registers that announcement into its
// claude_updates_changed hint, so the panel reads on the write and not on a clock.
//
// protects: server/modules/claude-updates/update-job.ts, server/modules/claude-updates/update-check.store.ts, server/modules/claude-updates/update-written.ts, server/modules/claude-updates/claude-updates.module.ts
// writes: none

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const UPDATE_JOB = "../../server/modules/claude-updates/update-job.ts";
const UPDATE_CHECK_STORE = "../../server/modules/claude-updates/update-check.store.ts";
const UPDATE_WRITTEN = "../../server/modules/claude-updates/update-written.ts";
const UPDATES_MODULE = "../../server/modules/claude-updates/claude-updates.module.ts";

runCase(async (t: unknown) => {
  const dir = await scratchDir(t, "update-written");
  const written: any = await import(UPDATE_WRITTEN);
  const job: any = await import(UPDATE_JOB);
  const store: any = await import(UPDATE_CHECK_STORE);

  let marker = "";
  const seen: string[] = [];
  written.onUpdateFileWritten(() => {
    const names = fs.readdirSync(dir);
    const temp = names.filter((name) => name.includes(".tmp-"));
    const whole = names.filter((name) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")).marker === marker;
      } catch {
        return false;
      }
    });
    if (temp.length > 0) seen.push("a temp file " + temp.join(" "));
    else if (whole.length === 1) seen.push("whole " + whole[0]);
    else seen.push("no whole file carrying " + marker);
  });

  const writes: Array<[string, () => void]> = [
    ["writeJob", () => job.writeJob(dir, { marker, state: "case", logTail: ["kept out of the file"] })],
    ["writeStoredCheck", () => store.writeStoredCheck(dir, { checkedAt: Date.now(), error: null, cli: {}, sdk: {}, marker })],
  ];
  const said: string[] = [];
  for (const [what, run] of writes) {
    marker = what + "-" + process.pid;
    seen.length = 0;
    run();
    if (seen.length !== 1) return broken(what + " announced " + seen.length + " times through onUpdateFileWritten, not once");
    if (!seen[0].startsWith("whole ")) return broken("when " + what + " announced, the folder held " + seen[0]);
    said.push(what + ": " + seen[0]);
  }

  const moduleText = fs.readFileSync(fileURLToPath(new URL(UPDATES_MODULE, import.meta.url)), "utf8");
  if (!moduleText.includes("onUpdateFileWritten(") || !moduleText.includes("claude_updates_changed")) {
    return broken("claude-updates.module.ts does not register onUpdateFileWritten into a claude_updates_changed hint");
  }
  return held("each writer announced once with its file whole (" + said.join("; ") + "); the module registers the announcement into claude_updates_changed");
});
