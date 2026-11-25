// protects: src/modules/gemini-spend/useGeminiUsage.ts, src/modules/gemini-spend/GeminiUsagePanel.tsx, src/modules/gemini-spend/GeminiTotal.tsx, src/modules/gemini-spend/GeminiDoorDown.tsx
// writes: none
//
// One door down is that door's sentence in its place, and the other still draws. In the real view, mounted in the running
// app's page with both doors answered by the case (lib/gemini_panel.mjs): with the connector's read answering 502 its
// place reads the lane's sentence while CloudCLI's section draws its three switches, and the total is CloudCLI's alone;
// with the meter answering 500 instead, CloudCLI's place reads its sentence while Restorly's and shadow-connector's
// sections draw, and the total is the connector's alone; with both answering, the total is their sum. A figure is looked
// for in the view's own words for it (geminiFigures.usdWords), and the sum (3.53) is a figure no section draws.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { CONNECTOR_TOTAL, METER_TOTAL, geminiPanel, sleep, until } from "../lib/gemini_panel.mjs";

const CONNECTOR_DOWN = "Case: shadow-connector did not answer";
const METER_DOWN = "Case: the meter did not answer";

runCase(async (t) => {
  const panel = await geminiPanel(t, { serve: { connector: () => ({ status: 502, body: { error: CONNECTOR_DOWN } }) } });
  if (panel.cannot) return cannotRun(panel.cannot);
  if (panel.error) return broken(panel.error);
  const sum = await panel.usd(Math.round((CONNECTOR_TOTAL + METER_TOTAL) * 100) / 100);
  const connectorOnly = await panel.usd(CONNECTOR_TOTAL);
  const wrong = [];
  const said = [];

  const down = await until(() => panel.downAt("connector"), 10000);
  if (!down) return broken("with the connector answering 502 its place never drew a door-down sentence (reads " + JSON.stringify(panel.asked) + ")");
  if (!down.includes(CONNECTOR_DOWN)) wrong.push("the connector's place reads " + JSON.stringify(down.slice(0, 160)) + ", not its sentence");
  const cloudcli = await panel.switches("cloudcli");
  if (!cloudcli || cloudcli.length !== 3 || (await panel.downAt("cloudcli"))) wrong.push("with the connector down CloudCLI drew " + JSON.stringify(cloudcli) + ", not its three switches");
  let text = await panel.text();
  if (text.includes(sum) || text.includes(connectorOnly)) wrong.push("with the connector down the view still shows " + (text.includes(sum) ? sum : connectorOnly));
  said.push("connector down: its sentence, CloudCLI " + (cloudcli?.length ?? 0) + " switches");

  panel.serve.connector = panel.defaults.connector;
  panel.serve.meter = () => ({ status: 500, body: { error: METER_DOWN } });
  await panel.visible();
  const meterDown = await until(() => panel.downAt("cloudcli"), 6000);
  if (!meterDown || !meterDown.includes(METER_DOWN)) wrong.push("with the meter answering 500 CloudCLI's place reads " + JSON.stringify(meterDown));
  for (const section of ["restorly", "shadowconnector"]) {
    const drawn = await panel.switches(section);
    if (!drawn || drawn.length !== 1) wrong.push("with the meter down " + section + " drew " + JSON.stringify(drawn));
  }
  text = await panel.text();
  if (text.includes(sum)) wrong.push("with the meter down the view shows the two-door sum " + sum);
  if (!text.includes(connectorOnly)) wrong.push("with the meter down no total reads the connector's " + connectorOnly);
  said.push("meter down: its sentence, the connector's sections, total " + connectorOnly);

  panel.serve.meter = panel.defaults.meter;
  await panel.visible();
  const both = await until(async () => (await panel.text()).includes(sum), 6000);
  if (!both) wrong.push("with both doors answering no total reads their sum " + sum);
  said.push("both: total " + (both ? sum : "missing"));

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(said.join("; "));
});
