// protects: server/shared/dispatcher-store-watch.service.ts
// writes: none
//
// pollers-hooks--client-pushes, seam 8: the store watch's accounts lane. An event on the door's account files
// (accounts.json, chosen.json) in the account home pokes the status lane (the document names the account in use) and
// the accounts lane (accounts_changed and the usage window); any other file there pokes no accounts lane. The store
// watch runs over a scratch state root whose account home is the case's own; nothing live is written.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { broken, held, runCase } from "../lib/case.mjs";

const WATCH = "/home/lyphe/.claude/claudecodeui_lyphe/server/shared/dispatcher-store-watch.service.ts";
const PREFIX = "case-store-watch-accounts-";
const LANES = ["status", "roadmap", "rnd", "accounts"];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t: any) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
  t.defer(() => {
    if (path.basename(scratch).startsWith(PREFIX)) fs.rmSync(scratch, { recursive: true, force: true });
  });
  const state = path.join(scratch, "state");
  const accountDir = path.join(state, "claude_account");
  for (const dir of ["dispatcher", "claude_account", "pacer", "dispatch-chains"]) fs.mkdirSync(path.join(state, dir), { recursive: true });
  fs.mkdirSync(path.join(scratch, "run", "systemd", "transient"), { recursive: true });
  const env = {
    ...process.env,
    DISPATCHER_HOME: path.join(state, "dispatcher"),
    PLAN_RUNNER_CLAUDE_ACCOUNT_HOME: accountDir,
    PLAN_RUNNER_PACER_HOME: path.join(state, "pacer"),
    XDG_RUNTIME_DIR: path.join(scratch, "run"),
  };
  const { createDispatcherStoreWatch } = await import(WATCH);
  const errors: string[] = [];
  // The board gate is asked only about a write to the store's database, which this case never makes.
  const watch = createDispatcherStoreWatch({ logError: (m: string) => errors.push(m), readBoardVersion: () => new Promise(() => {}), env });
  const counts: Record<string, number> = {};
  for (const lane of LANES) {
    counts[lane] = 0;
    try {
      watch.attach(lane, () => { counts[lane] += 1; });
    } catch (error) {
      return broken("attach('" + lane + "') threw: " + (error instanceof Error ? error.message : String(error)));
    }
  }
  watch.start();
  t.defer(() => watch.stop());
  await sleep(1500);
  const zero = () => { for (const lane of LANES) counts[lane] = 0; };
  zero();
  fs.writeFileSync(path.join(accountDir, "tokens.json"), "{}");
  await sleep(1500);
  if (counts.accounts > 0) return broken("a write to tokens.json in the account home poked the accounts lane " + counts.accounts + " times");
  for (const name of ["chosen.json", "accounts.json"]) {
    zero();
    fs.writeFileSync(path.join(accountDir, name), JSON.stringify({ digest: "cafe0001", slug: "case" }));
    await sleep(2000);
    if (counts.accounts === 0) return broken("a write to " + name + " poked no accounts lane within 2 s" + (errors[0] ? " (" + errors[0] + ")" : ""));
    if (counts.status === 0) return broken("a write to " + name + " poked the accounts lane but not the status lane");
  }
  return held("chosen.json and accounts.json each poked the accounts and status lanes within 2 s; tokens.json poked no accounts lane");
});
