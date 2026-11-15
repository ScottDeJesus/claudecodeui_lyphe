// CannotRun is ONE class for the EIS app's cases and the kit. A script that takes its five names from the
// EIS app's cases/lib/case.mjs holds the kit's own objects; a CannotRun the kit's HTTP door throws is an
// instance of the helper's class; and a kit CannotRun thrown inside the helper's runCase ends the script
// with its whole message. Two classes would leave every `instanceof CannotRun` in the EIS app's lib false
// for an error the kit threw, and a kit refusal would end a case on the first line of its message only.
//
// The scripts are written in a scratch folder and import the helper by its path. The one request goes to a
// loopback port this case opened and closed, so nothing answers it.
//
// To see it fail: CASE_SUITE_HELPER=<the helper as git held it before it became the door> reads BROKEN.
//
// protects: /opt/eis-app/cases/lib/case.mjs, /home/lyphe/.claude/hooks/cases/kit/node/door.mjs, /home/lyphe/.claude/hooks/cases/kit/node/case.mjs, /home/lyphe/.claude/hooks/cases/kit/node/http.mjs
// writes: none

import net from "node:net";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";
import { describe, helperOf, kitUrl, runnerEnv, runScript, writeScript } from "../lib/suite_helper.mjs";

const SUITE = "eis-app";
const NAMES = ["runCase", "held", "broken", "cannotRun", "CannotRun"];
const TWO_LINES = ["the kit refused", "and said why on a second line"];
const FACTS_MARK = "FACTS:";

// Says, for each name, whether the helper's object is the kit's own, and whether the kit door's error is the helper's class.
const IDENTITY_SOURCE = `
runCase(async () => {
  const mine = { runCase, held, broken, cannotRun, CannotRun };
  const kit = await import(process.env.KIT_CASE_URL);
  const { door } = await import(process.env.KIT_HTTP_URL);
  const same = Object.fromEntries(Object.keys(mine).map((name) => [name, mine[name] === kit[name]]));
  let thrown = null;
  try {
    await door(process.env.CLOSED_ORIGIN, { name: "a closed port" })("/nothing");
  } catch (error) {
    thrown = { isHelpersCannotRun: error instanceof CannotRun, message: String(error.message) };
  }
  console.error(${JSON.stringify(FACTS_MARK)} + JSON.stringify({ same, thrown }));
  return held("the body ran");
});
`;

// Throws the KIT's CannotRun, with a message of two lines, inside the HELPER's runCase.
const THROWN_SOURCE = `
runCase(async () => {
  const kit = await import(process.env.KIT_CASE_URL);
  throw new kit.CannotRun(${JSON.stringify(TWO_LINES.join("\n"))});
});
`;

/** `http://127.0.0.1:<a port nothing listens on>`: opened by this process, read, and closed again. */
async function closedOrigin() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}`;
}

runCase(async (t) => {
  const helper = await helperOf(SUITE);
  const dir = await scratchDir(t, "suite-helper-class");
  const env = runnerEnv({ KIT_CASE_URL: kitUrl("case"), KIT_HTTP_URL: kitUrl("http"), CLOSED_ORIGIN: await closedOrigin() });

  const identity = await runScript(writeScript(dir, "identity.mjs", { helper, source: IDENTITY_SOURCE }), { env });
  const factsLine = identity.stderr.split("\n").find((line) => line.startsWith(FACTS_MARK));
  if (identity.code !== 0 || identity.last !== "HELD: the body ran" || !factsLine) {
    return broken(`a script on ${helper} that reaches the kit did not end HELD with its facts: it ${describe(identity)}`);
  }
  const { same, thrown } = JSON.parse(factsLine.slice(FACTS_MARK.length));
  const copies = NAMES.filter((name) => !same[name]);
  if (copies.length > 0) return broken(`${helper} hands on ${copies.join(", ")} as objects of its own, not the kit's: two copies of the contract are loaded`);
  if (thrown === null) return broken("the kit's HTTP door answered on a closed port: nothing was thrown to judge");
  if (!thrown.isHelpersCannotRun) return broken(`the kit's HTTP door threw "${thrown.message}", which is not an instance of the CannotRun ${helper} hands on`);

  const refusal = await runScript(writeScript(dir, "thrown.mjs", { helper, source: THROWN_SOURCE }), { env });
  const wanted = `CANNOT RUN: ${TWO_LINES.join(" ")}`;
  if (refusal.code !== 2 || refusal.last !== wanted) {
    return broken(`a kit CannotRun thrown inside the runCase of ${helper} should end "${wanted}" with exit 2: the script ${describe(refusal)}`);
  }
  return held(`on ${helper}, ${NAMES.join(", ")} are the kit's own objects, the kit door's "${thrown.message}" is an instance of its CannotRun, and a two-line kit CannotRun ended "${wanted}" with exit 2`);
});
