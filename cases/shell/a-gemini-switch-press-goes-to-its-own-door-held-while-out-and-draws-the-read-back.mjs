// protects: src/modules/gemini-spend/useGeminiUsage.ts, src/modules/gemini-spend/GeminiUsagePanel.tsx, src/modules/gemini-spend/GeminiFeatureRow.tsx, src/shared/api.ts
// writes: none
//
// A press goes to the feature's own door and draws what that door read back. In the real view, mounted in the running
// app's page with both doors answered by the case (lib/gemini_panel.mjs, so no switch moves anywhere): a press on
// CloudCLI's read_aloud sends PUT /api/gemini-meter/switches/read_aloud {"enabled":false} and its switch is disabled while
// that PUT is out, then reads off, and both doors are re-read once; a press on the shadow-connector feature sends
// PUT /api/gemini-usage/switches/<feature>; a door that reads back on for a press of off is drawn on; a refused press keeps
// the switch where it stood and says the door's sentence.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { geminiPanel, sleep, until } from "../lib/gemini_panel.mjs";

const REFUSAL = "Case refusal: the switch file is locked";

runCase(async (t) => {
  const panel = await geminiPanel(t);
  if (panel.cannot) return cannotRun(panel.cannot);
  if (panel.error) return broken(panel.error);
  if (!(await until(() => panel.drawn(), 10000))) return broken("the view drew neither door's place within 10 s of mounting");
  await sleep(1000);
  const start = await panel.switches("cloudcli");
  if (!start || start.length !== 3 || start.some((s) => !s.checked)) return broken("the CloudCLI section did not draw its three switches on: " + JSON.stringify(start));
  const wrong = [];
  const said = [];

  panel.putDelayMs = 2500;
  let from = panel.asked.length;
  if (!(await panel.press("cloudcli", 1))) return broken("read_aloud's switch could not be pressed");
  await sleep(900);
  const during = (await panel.switches("cloudcli"))[1];
  if (!during?.disabled) wrong.push("read_aloud's switch was not held while its PUT was out: " + JSON.stringify(during));
  await until(async () => panel.puts.length >= 1 && panel.asked.length >= from + 2, 8000);
  await sleep(1500);
  panel.putDelayMs = 0;
  const first = panel.puts[0];
  if (!first || first.door !== "meter" || first.feature !== "read_aloud" || first.method !== "PUT" || JSON.stringify(first.body) !== '{"enabled":false}') {
    wrong.push("the press on read_aloud sent " + JSON.stringify(first) + ", not PUT /api/gemini-meter/switches/read_aloud {\"enabled\":false}");
  }
  const after = (await panel.switches("cloudcli"))[1];
  if (!after || after.checked || after.disabled) wrong.push("after the read-back read_aloud's switch reads " + JSON.stringify(after) + ", not off and free");
  const reread = panel.reads(from);
  if (reread.connector.length !== 1 || reread.meter.length !== 1) wrong.push("after the press the doors were read " + JSON.stringify(reread) + ", not once each");
  said.push("read_aloud: " + (first ? first.method + " " + first.door + " " + JSON.stringify(first.body) : "nothing") + ", held " + !!during?.disabled + ", re-read " + JSON.stringify(reread));

  if (!(await panel.press("shadowconnector", 0))) wrong.push("the shadow-connector feature's switch could not be pressed");
  await until(() => panel.puts.length >= 2, 5000);
  await sleep(1500);
  const second = panel.puts[1];
  if (!second || second.door !== "connector" || second.feature !== "case_connector_feature" || JSON.stringify(second.body) !== '{"enabled":false}') {
    wrong.push("the press on the shadow-connector feature sent " + JSON.stringify(second) + ", not PUT /api/gemini-usage/switches/case_connector_feature");
  }
  const connectorAfter = (await panel.switches("shadowconnector"))?.[0];
  if (!connectorAfter || connectorAfter.checked) wrong.push("the shadow-connector feature's switch reads " + JSON.stringify(connectorAfter) + " after its read-back of off");
  said.push("shadow-connector feature: " + (second ? second.door : "nothing"));

  panel.serve.put = (put) => ({ status: 200, body: { feature: put.feature, enabled: true } });
  await panel.press("cloudcli", 2);
  await until(() => panel.puts.length >= 3, 5000);
  await sleep(1500);
  const kept = (await panel.switches("cloudcli"))[2];
  if (!kept?.checked) wrong.push("a door that read back on for a press of off is drawn " + JSON.stringify(kept) + ", not on");
  said.push("read back on for a press of off: drawn " + (kept?.checked ? "on" : "off"));

  panel.serve.put = () => ({ status: 409, body: { error: REFUSAL } });
  await panel.press("cloudcli", 0);
  await until(() => panel.puts.length >= 4, 5000);
  await sleep(1500);
  const failure = await panel.page.evaluate(() => document.querySelector("[data-athena-gemini] [data-gemini-press-failed]")?.textContent ?? null);
  if (!failure || !failure.includes(REFUSAL)) wrong.push("a refused press said " + JSON.stringify(failure) + ", not the door's sentence");
  const stood = (await panel.switches("cloudcli"))[0];
  if (!stood?.checked || stood.disabled) wrong.push("after a refused press of off the switch reads " + JSON.stringify(stood) + ", not on and free");
  said.push("refused: " + (failure ? "said" : "silent"));

  const misdirected = panel.puts.filter((p) => (p.door === "meter") !== ["companion_speech", "read_aloud", "backup_transcription"].includes(p.feature));
  if (misdirected.length > 0) wrong.push("presses sent to another feature's door: " + JSON.stringify(misdirected));

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(said.join("; "));
});
