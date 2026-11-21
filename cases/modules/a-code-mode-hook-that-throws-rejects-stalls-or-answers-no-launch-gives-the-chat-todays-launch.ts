// protects: server/modules/providers/list/claude/claude-code-mode-seams.ts, server/shared/code-mode-types.ts
// writes: none
//
// A failure of Code Mode must never break the message it rides on (MAN-8487's failure clause, INV-78, INV-1): the
// runtime asks context.codeMode.launchFor through askCodeModeLaunch, and anything but a well-formed launch inside the
// deadline answers { on: false }, so the chat launches as it does today. A good on launch is handed back as a copy:
// the runtime installs it into the chat's options, so a hook that later changes its own object changes nothing.
//
// Every hook here is a stub on a stand-in context: nothing reaches the house verb, a database or a CLI.

import { broken, held, runCase } from "../lib/case.mjs";

const SEAM = "../../server/modules/providers/list/claude/claude-code-mode-seams.ts";
const DEADLINE_MS = 150;
const SLACK_MS = 1500;

type Launch = Record<string, unknown>;
type Ask = (context: unknown, input: Record<string, unknown>, deadlineMs?: number) => Promise<Launch>;

const goodLaunch = () => ({
  on: true,
  tools: ["AskUserQuestion", "Agent"],
  server: { command: "/usr/bin/node", args: ["--no-node-snapshot", "/x/server.mjs", "--config", "/x/server.json"] },
  prompt: "You work with one search and one script.",
  env: { CODE_MODE_KIND: "chats", MCP_TOOL_TIMEOUT: "960000" },
});

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  // The seam's deadline timer is unref'd, as it should be in a server; this case process has nothing else alive while a
  // stalled hook is awaited, so it holds the loop open itself.
  const keepAlive = setInterval(() => {}, 1000);
  t.defer(() => clearInterval(keepAlive));
  let ask: Ask;
  try {
    ask = (await import(SEAM)).askCodeModeLaunch;
  } catch (error) {
    return broken(`the Code Mode seam will not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  if (typeof ask !== "function") return broken("claude-code-mode-seams.ts exports no askCodeModeLaunch");

  const input = { appSessionId: "case-chat", onNode: false, cwd: "/tmp", servers: {} };
  const hooks: Array<[string, () => unknown]> = [
    ["throws", () => { throw new Error("verb exploded"); }],
    ["rejects", () => Promise.reject(new Error("verb exited 1"))],
    ["never settles", () => new Promise(() => {})],
    ["answers null", async () => null],
    ["answers on with no tools", async () => ({ ...goodLaunch(), tools: undefined })],
    ["answers on with a non-string tool", async () => ({ ...goodLaunch(), tools: ["Agent", 7] })],
    ["answers on with a non-string env value", async () => ({ ...goodLaunch(), env: { CODE_MODE_KIND: 1 } })],
    ["answers on with an empty command", async () => ({ ...goodLaunch(), server: { command: "", args: [] } })],
    ["answers on: 'yes'", async () => ({ ...goodLaunch(), on: "yes" })],
  ];

  const wrong: string[] = [];
  for (const [label, launchFor] of hooks) {
    const context = { codeMode: { launchFor, serversChanged: async () => {} } };
    const started = Date.now();
    let answer: unknown;
    try {
      answer = await ask(context, input, DEADLINE_MS);
    } catch (error) {
      wrong.push(`a hook that ${label}: askCodeModeLaunch threw (${String((error as Error)?.message ?? error)})`);
      continue;
    }
    const took = Date.now() - started;
    if (JSON.stringify(answer) !== '{"on":false}') wrong.push(`a hook that ${label} was answered ${JSON.stringify(answer)}, not {"on":false}`);
    if (took > DEADLINE_MS + SLACK_MS) wrong.push(`a hook that ${label} held the launch ${took} ms against a ${DEADLINE_MS} ms deadline`);
  }

  const handed = goodLaunch();
  const answer = await ask({ codeMode: { launchFor: async () => handed, serversChanged: async () => {} } }, input, DEADLINE_MS);
  if (JSON.stringify(answer) !== JSON.stringify(goodLaunch())) {
    wrong.push(`a well-formed on launch came back as ${JSON.stringify(answer)}`);
  } else {
    handed.tools.push("Bash");
    handed.server.args.push("--evil");
    (handed.env as Record<string, string>).EXTRA = "1";
    if (JSON.stringify(answer) !== JSON.stringify(goodLaunch())) wrong.push("the launch the runtime holds changed when the hook changed its own object afterwards");
  }

  const offAnswer = await ask({ codeMode: { launchFor: async () => ({ on: false }), serversChanged: async () => {} } }, input, DEADLINE_MS);
  if (JSON.stringify(offAnswer) !== '{"on":false}') wrong.push(`a hook that answered off came back as ${JSON.stringify(offAnswer)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`all ${hooks.length} failing hooks answered {"on":false} inside the deadline without a throw; a good on launch came back as a copy the hook cannot change, and off as off`);
});
