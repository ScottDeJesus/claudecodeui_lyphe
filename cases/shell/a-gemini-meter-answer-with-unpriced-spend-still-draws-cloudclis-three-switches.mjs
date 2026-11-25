// protects: src/modules/gemini-spend/useGeminiUsage.ts, src/modules/gemini-spend/GeminiTotal.tsx, src/modules/gemini-spend/types.ts
// writes: none
//
// CloudCLI's meter answers cost_usd null when it holds rows and no model of theirs has a rate
// (server/modules/gemini-meter/gemini-meter.service.ts costOfRows; MANUAL: cost_usd is "number or null"). That is a
// valid 200 answer, not a door down: in the real view, mounted in the running app's page with both doors answered by
// the case (lib/gemini_panel.mjs), a meter body carrying null dollars at the top, on its three rows and on its day, with
// the model in unpriced_models, must still draw CloudCLI's three switches (the only way to turn that spend off) and no
// door-down sentence in CloudCLI's place, while the connector's total still draws.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { CONNECTOR_TOTAL, geminiPanel, until } from "../lib/gemini_panel.mjs";

const MODEL = "gemini-case-unpriced-model";
const FEATURES = [["companion_speech", "Case Companion Speech"], ["read_aloud", "Case Read Aloud"], ["backup_transcription", "Case Backup Transcription"]];

function unpricedMeter(range) {
  const day = new Date().toISOString().slice(0, 10);
  const at = new Date().toISOString();
  return {
    range, from: day, to: day, cost_basis: "list prices, an estimate", project: "cloudcli", cost_usd: null, calls: 6,
    features: FEATURES.map(([feature, label]) => ({
      feature, label, enabled: true, calls: 2, failures: 0, unmeasured_calls: 0, input_tokens: 120, output_tokens: 40,
      cost_usd: null, models: [MODEL], last_at: at,
    })),
    days: [{ date: day, cost_usd: null }],
    keys: [{ key: "Cd34", held_as: ["house"], calls: 6, cost_usd: null }],
    unpriced_models: [MODEL],
  };
}

runCase(async (t) => {
  const panel = await geminiPanel(t, { serve: { meter: (range) => ({ status: 200, body: unpricedMeter(range) }) } });
  if (panel.cannot) return cannotRun(panel.cannot);
  if (panel.error) return broken(panel.error);
  const settled = await until(async () => ((await panel.switches("cloudcli"))?.length === 3) || (await panel.downAt("cloudcli")), 10000);
  if (!settled) return broken("CloudCLI's place drew neither its switches nor a door-down sentence in 10 s (reads " + JSON.stringify(panel.asked) + ")");
  const down = await panel.downAt("cloudcli");
  const switches = await panel.switches("cloudcli");
  const wrong = [];
  if (down) wrong.push("the meter's 200 answer with unpriced spend (cost_usd null) drew as a door down: " + JSON.stringify(down.slice(0, 160)));
  if (!switches || switches.length !== 3) wrong.push("CloudCLI drew " + JSON.stringify(switches) + ", not its three switches");
  const connectorOnly = await panel.usd(CONNECTOR_TOTAL);
  if (!(await panel.text()).includes(connectorOnly)) wrong.push("no total reads the connector's " + connectorOnly);
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("unpriced meter answer: no door-down, CloudCLI 3 switches, the connector's " + connectorOnly + " drawn");
});
