// One walk through the command opens Restorly's no-job screen at desktop in light and in dark and reads the Views tab
// Schedule's text colour: the walk answers ok and the two variants read different colours, so the adapter's theme drew
// each theme as asked.
//
// protects: /opt/eis-app/walk/app.mjs, /home/lyphe/.claude/hooks/web_walk/node/
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";
import { webWalk } from "../lib/web_walk.mjs";

const LABEL = "schedule colour";
const WALK = {
  app: "restorly", sizes: ["desktop"], themes: ["light", "dark"], timeout_ms: 100000,
  steps: [
    { open: "no-job" },
    { read: LABEL, of: { role: "tab", name: "Schedule", exact: false, in: { role: "tablist", name: "Views" } }, as: "style:color" },
  ],
};

runCase(async (t) => {
  const out = await scratchDir(t, "walk-themes");
  const ran = await webWalk(["run", "-", "--out", out], { input: JSON.stringify(WALK) });
  if (ran.error) return broken("web-walk run did not end: " + ran.error.message);
  const answer = ran.answer;
  if (!answer) return broken("exit " + ran.status + ", no answer: " + (ran.stderr.trim().split("\n").pop() ?? ""));
  if (answer.fault?.kind === "app-down") return cannotRun("Restorly is down: " + answer.fault.why);
  if (answer.ok !== true) return broken("ok " + answer.ok + ": " + String(answer.summary).slice(0, 300));
  const colours = answer.read?.[LABEL] ?? {};
  const light = colours["desktop/light"];
  const dark = colours["desktop/dark"];
  if (!light || !dark) return broken("the read has no colour per variant: " + JSON.stringify(colours));
  if (light === dark) return broken("both themes drew the Schedule tab in " + light);
  return held("the Schedule tab reads " + light + " in light and " + dark + " in dark");
});
