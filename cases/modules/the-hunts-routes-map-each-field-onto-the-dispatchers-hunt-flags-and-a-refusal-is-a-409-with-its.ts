// protects: server/modules/kanban-dispatch/kanban-dispatch.hunts.ts, server/modules/kanban-dispatch/kanban-dispatch.routes.ts, server/modules/kanban-dispatch/kanban-dispatch.module.ts, server/modules/kanban-dispatch/index.ts
// writes: none
//
// THE HUNTS' ROUTES (bug-hunters seam 10), each one `runDispatcherCommand` whose first line is the answer and whose
// refusal (exit 2, `REFUSED ...`) is a 409 carrying the dispatcher's sentence:
//   GET  /hunts/settings   `hunt config --json`, the config answered as the dispatcher printed it
//   PUT  /hunts/settings   {nightly?, start?, minutes?, order?, turns?, projects?, ticketsPerNight?} onto `hunt config`'s
//                          `--nightly on|off --start --minutes --order K,K --turns --projects N,N --tickets`; an empty
//                          `order` is `--order ""` (the config says one may be empty: no hunter takes a turn)
//   POST /hunts/night      {minutes?}: `hunt night --now`, `--minutes N` only when sent (the dashboard's press sends none)
//   POST /hunts/stop       {now?}: `hunt stop`, `--now` only when asked
//   POST /hunts/reopen     {hunt, project, unit}: `hunt reopen HUNT PROJECT UNIT`
// The dispatcher is the stand-in of lib/dispatch_routes.mjs; nothing reaches the real one.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { quietJournal } from "../lib/board_placing.mjs";
import { routesRig } from "../lib/dispatch_routes.mjs";

const CONFIG = {
  nightly: false, start: "00:30", minutes: 120, grace: 15, min_left: 20, tickets_per_night: 15, batch: 12,
  order: ["security", "behaviour", "ui", "data", "code"], turns: "project", exclude: ["**/*.md"], lenses: {},
  projects: [{ name: "The house", path: "/h", exclude: [], databases: [] }, { name: "CloudCLI", path: "/c", exclude: [], databases: [] }],
  path: "/scratch/hunts.toml", crontab: null,
};
const REFUSED_PROJECTS = "REFUSED hunt config: 'Nope' is not a project in /scratch/hunts.toml — a project is added or removed by editing the file";
const REFUSED_REOPEN = "REFUSED hunt reopen: 'refuse-me' is not a skipped unit of the open pass";

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const rig: any = await routesRig(t, "hunts-routes", [
    { has: ["hunt", "config", "--projects", "Nope"], stdout: REFUSED_PROJECTS, exit: 2 },
    { has: ["hunt", "config"], stdout: JSON.stringify(CONFIG) },
    { has: ["hunt", "night"], stdout: "OPENED night 2026-11-20 — 120 minutes" },
    { has: ["hunt", "stop"], stdout: "STOPPED night 2026-11-20 — stopped by the operator" },
    { has: ["hunt", "reopen", "refuse-me"], stdout: REFUSED_REOPEN, exit: 2 },
    { has: ["hunt", "reopen"], stdout: "REOPENED src/x.py" },
  ]);
  quietJournal(t);
  await rig.open();
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
  const exactly = async (what: string, answer: any, argv: string[]) => {
    const heard = await lastArgv();
    if (answer.status !== 200) wrong.push(`${what} answered ${answer.status} ${answer.text.slice(0, 100)}`);
    if (JSON.stringify(heard) !== JSON.stringify(argv)) wrong.push(`${what} ran ${JSON.stringify(heard)}, not ${JSON.stringify(argv)}`);
  };
  /** A flag's value in an argv, spelled `--flag value` or `--flag=value` (argparse reads both alike). */
  const valueOf = (argv: string[], flag: string): string | undefined => {
    const joined = argv.find((word) => word.startsWith(`${flag}=`));
    if (joined !== undefined) return joined.slice(flag.length + 1);
    const at = argv.indexOf(flag);
    return at < 0 ? undefined : argv[at + 1];
  };
  /** Each flag's value in the argv the stand-in heard last. */
  const pairs = async (what: string, answer: any, expected: Record<string, string>) => {
    const heard: string[] | null = await lastArgv();
    if (answer.status !== 200) wrong.push(`${what} answered ${answer.status} ${answer.text.slice(0, 100)}`);
    if (!heard || heard[0] !== "hunt" || heard[1] !== "config" || !heard.includes("--json")) {
      wrong.push(`${what} ran ${JSON.stringify(heard)}, not hunt config ... --json`);
      return;
    }
    for (const [flag, value] of Object.entries(expected)) {
      const got = valueOf(heard, flag);
      if (got !== value) wrong.push(`${what} ran ${JSON.stringify(heard)}: ${flag} is ${got === undefined ? "missing" : JSON.stringify(got)}, not ${JSON.stringify(value)}`);
    }
    if (JSON.stringify(answer.json) !== JSON.stringify(CONFIG)) wrong.push(`${what} answered ${answer.text.slice(0, 80)}, not the config the dispatcher printed`);
  };

  const read = await route("GET", "/hunts/settings");
  await exactly("GET /hunts/settings", read, ["hunt", "config", "--json"]);
  if (JSON.stringify(read.json) !== JSON.stringify(CONFIG)) wrong.push(`GET /hunts/settings answered ${read.text.slice(0, 80)}, not the config as printed`);

  await pairs("PUT /hunts/settings (every field)", await route("PUT", "/hunts/settings", {
    nightly: true, start: "01:15", minutes: 90, order: ["code", "ui"], turns: "hunter", projects: ["The house", "CloudCLI"], ticketsPerNight: 7,
  }), { "--nightly": "on", "--start": "01:15", "--minutes": "90", "--order": "code,ui", "--turns": "hunter", "--projects": "The house,CloudCLI", "--tickets": "7" });
  await pairs("PUT /hunts/settings {nightly: false, order: []}", await route("PUT", "/hunts/settings", { nightly: false, order: [] }), { "--nightly": "off", "--order": "" });

  const refused = await route("PUT", "/hunts/settings", { projects: ["Nope"] });
  if (refused.status !== 409 || !refused.text.includes(JSON.stringify(REFUSED_PROJECTS).slice(1, -1))) {
    wrong.push(`PUT /hunts/settings the dispatcher refused answered ${refused.status} ${refused.text.slice(0, 160)}, not a 409 carrying its sentence`);
  }

  await exactly("POST /hunts/night {}", await route("POST", "/hunts/night", {}), ["hunt", "night", "--now"]);
  const night = await route("POST", "/hunts/night", { minutes: 20 });
  const nightArgv: string[] | null = await lastArgv();
  if (night.status !== 200 || !nightArgv || nightArgv.slice(0, 2).join(" ") !== "hunt night" || !nightArgv.includes("--now") || valueOf(nightArgv, "--minutes") !== "20") {
    wrong.push(`POST /hunts/night {minutes: 20} answered ${night.status} and ran ${JSON.stringify(nightArgv)}, not hunt night --now --minutes 20`);
  }
  await exactly("POST /hunts/stop {}", await route("POST", "/hunts/stop", {}), ["hunt", "stop"]);
  await exactly("POST /hunts/stop {now: true}", await route("POST", "/hunts/stop", { now: true }), ["hunt", "stop", "--now"]);
  await exactly("POST /hunts/reopen", await route("POST", "/hunts/reopen", { hunt: "code", project: "/h", unit: "src/x.py" }), ["hunt", "reopen", "code", "/h", "src/x.py"]);
  const noReopen = await route("POST", "/hunts/reopen", { hunt: "code", project: "/h", unit: "refuse-me" });
  if (noReopen.status !== 409 || !noReopen.text.includes(REFUSED_REOPEN)) wrong.push(`POST /hunts/reopen the dispatcher refused answered ${noReopen.status} ${noReopen.text.slice(0, 160)}, not a 409 carrying its sentence`);

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 900));
  return held("GET relayed hunt config --json as printed; PUT mapped all seven fields (an empty order to --order \"\"); night ran --now with --minutes only when sent; stop took --now only when asked; reopen passed its three words; both refusals were 409s carrying the sentence");
});
