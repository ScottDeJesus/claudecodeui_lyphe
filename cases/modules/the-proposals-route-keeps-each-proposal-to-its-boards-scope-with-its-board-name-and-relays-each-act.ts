// protects: server/modules/kanban-dispatch/kanban-dispatch.proposals.ts, server/modules/kanban-dispatch/kanban-dispatch.routes.ts, server/modules/kanban-dispatch/kanban-dispatch.module.ts, server/modules/kanban/kanban-boards.service.ts
// writes: none
//
// THE PROPOSALS' ROUTES (bug-hunters seam 10):
//   GET  /proposals?board=<id>|all&state=open|all   `bug proposals [--all] --json`, kept to the proposals whose path
//        `kanbanBoardsService.boardForPath` gives that board; each gains `boardName`. One board's scope holds no other
//        board's proposal and none no board holds; under `all` every board's proposal is there with its own board's name,
//        and one no board holds, if listed, carries no board's name. The door's order (high priority first, then the
//        oldest) is kept.
//   POST /proposals/:id/promote {arc} · /send-back · /dismiss {reason} · /priority {priority}   `bug proposal <act> <id>`
//        with `--arc`, `--reason`, or the priority word; a refusal (exit 2) is a 409 carrying the dispatcher's sentence.
// The dispatcher is the stand-in of lib/dispatch_routes.mjs; the boards live in a database this case makes.

import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { gitFolder, quietJournal } from "../lib/board_placing.mjs";
import { routesRig } from "../lib/dispatch_routes.mjs";

const REFUSED = 'REFUSED bug proposal dismiss: "The old one" is already dismissed';

function proposal(id: number, where: string, state: string, priority: string, title: string) {
  return {
    id, path: where, title, words: "the words", kind: "design", priority, state, hunt: "code", source: "hunter",
    proposed_at: `2026-11-1${id}T00:00:00Z`, ended_at: state === "open" ? null : "2026-11-19T00:00:00Z",
    feature: null, reason: state === "dismissed" ? "not now" : null, findings: [], stopgaps: [], sent_back: null,
  };
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const rig: any = await routesRig(t, "proposals-routes", []);
  const A = await gitFolder(path.join(rig.folder, "repo-a"));
  const B = await gitFolder(path.join(rig.folder, "repo-b"));
  const nowhere = await gitFolder(path.join(rig.folder, "no-board"));
  const all = [
    proposal(1, path.join(A, "sub"), "open", "high", "On A, open"),
    proposal(2, B, "open", "medium", "On B, open"),
    proposal(3, nowhere, "open", "medium", "On no board"),
    proposal(4, A, "dismissed", "low", "The old one"),
  ];
  await rig.rules([
    { has: ["bug", "proposals", "--all"], stdout: JSON.stringify({ proposals: all }) },
    { has: ["bug", "proposals"], stdout: JSON.stringify({ proposals: all.filter((p) => p.state === "open") }) },
    { has: ["bug", "proposal", "dismiss", "4"], stdout: REFUSED, exit: 2 },
    { has: ["bug", "proposal", "promote"], stdout: 'PROMOTED proposal 1 — On A, open — an idea under The epic' },
    { has: ["bug", "proposal", "send-back"], stdout: "FILED ticket 9 — On B, open" },
    { has: ["bug", "proposal", "dismiss"], stdout: 'DISMISSED proposal 2 — On B, open' },
    { has: ["bug", "proposal", "priority"], stdout: 'PRIORITY proposal 1 — On A, open — low' },
  ]);
  quietJournal(t);
  const { kanban } = await rig.open();
  const { kanbanBoardsService: boards } = kanban as any;
  const boardA = boards.createBoard({ name: "Board A", repos: [A] });
  const boardB = boards.createBoard({ name: "Board B", repos: [B] });
  if (!boardA?.id || !boardB?.id) return cannotRun("the scratch boards would not be made");
  let route: any;
  try {
    route = await rig.mount();
  } catch (error) {
    return cannotRun(`the kanban-dispatch module would not mount: ${String((error as Error).message).split("\n")[0]}`);
  }

  const wrong: string[] = [];
  const lastArgv = async () => {
    const heard = await rig.calls();
    return heard.length ? heard[heard.length - 1].argv : null;
  };
  const listOf = (answer: any) => (Array.isArray(answer.json) ? answer.json : answer.json?.proposals);
  const seen = (answer: any) => (listOf(answer) ?? []).map((p: any) => `${p.id}:${p.boardName}`).join(",");

  const one = await route("GET", `/proposals?board=${encodeURIComponent(boardA.id)}&state=open`);
  const oneArgv = await lastArgv();
  if (one.status !== 200 || !Array.isArray(listOf(one))) wrong.push(`GET proposals of Board A answered ${one.status} ${one.text.slice(0, 100)}`);
  else if (seen(one) !== "1:Board A") wrong.push(`GET proposals of Board A, open, answered [${seen(one)}], not [1:Board A]`);
  if (!oneArgv || oneArgv.join(" ") !== "bug proposals --json") wrong.push(`the open read ran ${JSON.stringify(oneArgv)}, not bug proposals --json`);

  const every = await route("GET", "/proposals?board=all&state=all");
  const everyArgv: string[] | null = await lastArgv();
  if (every.status !== 200 || !Array.isArray(listOf(every))) wrong.push(`GET proposals of all boards answered ${every.status} ${every.text.slice(0, 100)}`);
  else if (!["1:Board A,2:Board B,4:Board A", "1:Board A,2:Board B,3:,4:Board A", "1:Board A,2:Board B,3:null,4:Board A"].includes(seen(every))) {
    wrong.push(`GET proposals board=all state=all answered [${seen(every)}], not [1:Board A,2:Board B,4:Board A] (each board's with its name, in the door's order; one no board holds named by no board)`);
  }
  else {
    const kept = listOf(every)[0];
    for (const key of Object.keys(all[0])) {
      if (JSON.stringify(kept[key]) !== JSON.stringify((all[0] as any)[key])) wrong.push(`the answered proposal's ${key} is ${JSON.stringify(kept[key])}, not the door's ${JSON.stringify((all[0] as any)[key])}`);
    }
  }
  if (!everyArgv || everyArgv.slice(0, 2).join(" ") !== "bug proposals" || !everyArgv.includes("--all") || !everyArgv.includes("--json")) wrong.push(`the all read ran ${JSON.stringify(everyArgv)}, not bug proposals --all --json`);

  const act = async (what: string, method: string, url: string, body: unknown, words: string[]) => {
    const answer = await route(method, url, body);
    const heard: string[] | null = await lastArgv();
    if (answer.status !== 200) wrong.push(`${what} answered ${answer.status} ${answer.text.slice(0, 100)}`);
    const head = heard ? heard.slice(0, words.length) : null;
    if (JSON.stringify(head) !== JSON.stringify(words)) wrong.push(`${what} ran ${JSON.stringify(heard)}, not ${words.join(" ")} ...`);
    return heard ?? [];
  };
  /** A flag's value, spelled `--flag value` or `--flag=value` (argparse reads both alike). */
  const value = (argv: string[], flag: string) => {
    const joined = argv.find((word) => word.startsWith(`${flag}=`));
    if (joined !== undefined) return joined.slice(flag.length + 1);
    return argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined;
  };

  const promoted = await act("promote", "POST", "/proposals/1/promote", { arc: "The epic" }, ["bug", "proposal", "promote", "1"]);
  if (value(promoted, "--arc") !== "The epic") wrong.push(`promote ran ${JSON.stringify(promoted)}: --arc is not "The epic"`);
  const sent = await act("send-back", "POST", "/proposals/2/send-back", {}, ["bug", "proposal", "send-back", "2"]);
  const dismissed = await act("dismiss", "POST", "/proposals/2/dismiss", { reason: "not this year" }, ["bug", "proposal", "dismiss", "2"]);
  if (value(dismissed, "--reason") !== "not this year") wrong.push(`dismiss ran ${JSON.stringify(dismissed)}: --reason is not "not this year"`);
  const priority = await act("priority", "POST", "/proposals/1/priority", { priority: "low" }, ["bug", "proposal", "priority", "1", "low"]);

  const refused = await route("POST", "/proposals/4/dismiss", { reason: "again" });
  if (refused.status !== 409 || !refused.text.includes(JSON.stringify(REFUSED).slice(1, -1))) wrong.push(`a dismiss the dispatcher refused answered ${refused.status} ${refused.text.slice(0, 160)}, not a 409 carrying its sentence`);

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 900));
  return held(`Board A's open read [${seen(one)}] without --all; the all read [${seen(every)}] with --all, the door's fields kept; promote, send-back (${sent.length} words), dismiss and priority (${priority.slice(4).join(" ")}) relayed; the refused dismiss a 409 with its sentence`);
});
