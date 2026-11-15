// A live case of the EIS app takes the SAME lock every other suite's live case takes. A script on the EIS
// app's cases/lib/case.mjs whose header says `writes: live` and `lock: <name>` holds the abstract unix
// socket `case-live:<name>` while its body runs, and leaves the EIS app's old name `eis-case-live:<name>`
// free; a script on this suite's own cases/lib/case.mjs naming the same lock does not reach its body until
// the first has ended; and the name is free once both have ended.
//
// The lock is only a name two processes agree on. A helper that goes back to a name of its own leaves every
// case running and every verdict HELD while two writers overlap, and nothing but a second process asking
// for the name can see it.
//
// The scripts change no data: each says "in-body" and waits for a line on stdin. The sockets are abstract,
// named with this run's random tag, and die with their process.
//
// To see it fail: CASE_SUITE_HELPER=<the helper as git held it before it became the door> reads BROKEN.
//
// protects: /opt/eis-app/cases/lib/case.mjs, /home/lyphe/.claude/hooks/cases/kit/node/door.mjs, /home/lyphe/.claude/hooks/cases/kit/node/case.mjs, cases/lib/case.mjs
// writes: none

import crypto from "node:crypto";
import net from "node:net";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";
import { describe, helperOf, OWN_HELPER, runnerEnv, startScript, writeScript } from "../lib/suite_helper.mjs";

const SUITE = "eis-app";
const TAG = crypto.randomBytes(4).toString("hex");
const SHARED = `suites-shared-${TAG}`;
const LOCK = `case-live:${SHARED}`;
const OLD_LOCK = `eis-case-live:${SHARED}`;
const HEADER = ["// writes: live", `// lock: ${SHARED}`];
const QUIET_MS = 1500; // how long the second holder is watched for a body it must not reach (the kit asks again every 100 ms)
const ENDED_WELL = "HELD: the body ran";

const SOURCE = `
runCase(async () => {
  console.error("in-body");
  await new Promise((resolve) => process.stdin.once("data", resolve));
  process.stdin.pause();
  return held("the body ran");
});
`;

/** "taken" when the abstract socket `name` has a listener, "free" when this process could take it (and gave it straight back). */
async function ask(name) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(`\0${name}`, resolve);
    });
  } catch (error) {
    if (error.code === "EADDRINUSE") return "taken";
    throw error;
  }
  await new Promise((resolve) => server.close(resolve));
  return "free";
}

runCase(async (t) => {
  const helper = await helperOf(SUITE);
  const dir = await scratchDir(t, "suite-helper-lock");
  const env = runnerEnv();

  const first = startScript(writeScript(dir, `first-${TAG}.mjs`, { header: HEADER, helper, source: SOURCE }), { env });
  t.defer(() => first.say("go\n")); // however this case ends, the script is let go
  if (!(await first.saw("in-body"))) return broken(`a live script on ${helper} never reached its body: it ${describe(await first.ended)}`);
  const whileRunning = { lock: await ask(LOCK), old: await ask(OLD_LOCK) };
  if (whileRunning.lock !== "taken" || whileRunning.old !== "free") {
    return broken(`while a live script on ${helper} ran its body, ${LOCK} was ${whileRunning.lock} (not taken) and ${OLD_LOCK} was ${whileRunning.old} (not free)`);
  }

  const second = startScript(writeScript(dir, `second-${TAG}.mjs`, { header: HEADER, helper: OWN_HELPER, source: SOURCE }), { env });
  t.defer(() => second.say("go\n"));
  if (await second.saw("in-body", QUIET_MS)) {
    return broken(`a script on this suite's own helper naming the lock ${SHARED} reached its body while the script on ${helper} still held it: the two overlap`);
  }
  first.say("go\n");
  const firstOut = await first.ended;
  if (firstOut.code !== 0 || firstOut.last !== ENDED_WELL) return broken(`the script on ${helper} did not end "${ENDED_WELL}": it ${describe(firstOut)}`);
  if (!(await second.saw("in-body"))) return broken(`the script on this suite's own helper never reached its body after the first ended: it ${describe(await second.ended)}`);
  second.say("go\n");
  const secondOut = await second.ended;
  if (secondOut.code !== 0 || secondOut.last !== ENDED_WELL) return broken(`the script on this suite's own helper did not end "${ENDED_WELL}": it ${describe(secondOut)}`);
  const after = await ask(LOCK);
  if (after !== "free") return broken(`${LOCK} was still ${after} after both scripts had ended`);

  return held(`a live script on ${helper} held ${LOCK} and left ${OLD_LOCK} free; a script on this suite's helper naming the same lock waited ${QUIET_MS} ms behind it, ran once it ended, and the name was free after both`);
});
