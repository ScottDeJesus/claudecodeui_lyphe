// protects: server/modules/gemini-meter/, server/modules/database/repositories/gemini-*, server/modules/database/gemini-meter-schema.ts
// writes: none
//
// The switch door reads back and the usage door lists the three CloudCLI features with it. Through the module's own
// router over a scratch database: PUT /switches/read_aloud {"enabled":false} answers 200 {feature, enabled:false}, the
// state read back, and geminiFeatureOff reads it at once; GET /usage?range=today answers project "cloudcli" with exactly
// the three features, each in the shared snake_case feature row, read_aloud enabled false and the other two true; a
// feature outside the three, a string or missing enabled and a range outside today|7d|30d are each 400; PUT on reads
// back true. The router is served on loopback behind a stand-in for authenticateToken (lib/gemini_meter.mjs).

import { broken, held, runCase } from "../lib/case.mjs";
import { FEATURE_ROW_KEYS, FEATURES, addUser, meterDoor, meterGround, shapeOf } from "../lib/gemini_meter.mjs";

const USAGE_KEYS = ["range", "from", "to", "cost_basis", "project", "cost_usd", "calls", "features", "days", "keys", "unpriced_models"];

runCase(async (t: any) => {
  const ground = await meterGround(t, "gemini-meter-door");
  if (!ground.meter) return broken(ground.missing);
  const door = await meterDoor(t, ground);
  if (!door) return broken("the gemini-meter barrel builds no router (no create...Module answering one)");
  const meter = ground.meter as any;
  const id = addUser(ground.db, "case-meter-door");
  const wrong: string[] = [];

  const off = await door("PUT", "/switches/read_aloud", id, { enabled: false });
  if (off.status !== 200) wrong.push("PUT read_aloud off answered " + off.status + " " + off.text.slice(0, 120));
  else if (shapeOf(off.json) !== "enabled,feature" || off.json.feature !== "read_aloud" || off.json.enabled !== false) {
    wrong.push("PUT read_aloud off answered " + off.text.slice(0, 160) + ", not {feature: read_aloud, enabled: false}");
  }
  if (typeof meter.geminiFeatureOff === "function" && meter.geminiFeatureOff(id, "read_aloud") !== true) {
    wrong.push("after the PUT, geminiFeatureOff(read_aloud) did not read true");
  }

  const usage = await door("GET", "/usage?range=today", id);
  if (usage.status !== 200) wrong.push("GET usage?range=today answered " + usage.status + " " + usage.text.slice(0, 120));
  else {
    const body = usage.json ?? {};
    for (const key of USAGE_KEYS) if (!(key in body)) wrong.push("the usage answer has no " + key);
    if (body.range !== "today") wrong.push("range reads " + JSON.stringify(body.range));
    if (body.project !== "cloudcli") wrong.push("project reads " + JSON.stringify(body.project) + ", not cloudcli");
    const features: any[] = Array.isArray(body.features) ? body.features : [];
    const listed = features.map((f) => f?.feature).sort().join(",");
    if (listed !== [...FEATURES].sort().join(",")) wrong.push("features listed " + listed + ", not the three");
    const rowShape = [...FEATURE_ROW_KEYS].sort().join(",");
    for (const f of features) {
      if (shapeOf(f) !== rowShape) wrong.push(f?.feature + "'s row has keys " + shapeOf(f) + ", not the shared row");
      const wantOn = f?.feature !== "read_aloud";
      if (f?.enabled !== wantOn) wrong.push(f?.feature + " reads enabled " + f?.enabled + ", not " + wantOn);
      if (typeof f?.label !== "string" || !f.label.trim()) wrong.push(f?.feature + " has no label");
    }
    for (const list of ["days", "keys", "unpriced_models"]) if (!Array.isArray(body[list])) wrong.push(list + " is not a list");
  }

  const bad: [string, string, string, unknown][] = [
    ["a feature outside the three", "PUT", "/switches/jev_speech", { enabled: false }],
    ["a string enabled", "PUT", "/switches/read_aloud", { enabled: "true" }],
    ["no enabled", "PUT", "/switches/read_aloud", {}],
    ["range=year", "GET", "/usage?range=year", undefined],
  ];
  for (const [what, method, route, body] of bad) {
    const answer = await door(method, route, id, body);
    if (answer.status !== 400) wrong.push(what + " answered " + answer.status + ", not 400");
  }
  if (typeof meter.geminiFeatureOff === "function" && meter.geminiFeatureOff(id, "read_aloud") !== true) {
    wrong.push("a refused PUT changed the read_aloud switch");
  }
  const on = await door("PUT", "/switches/read_aloud", id, { enabled: true });
  if (on.status !== 200 || on.json?.feature !== "read_aloud" || on.json?.enabled !== true) wrong.push("PUT read_aloud on answered " + on.status + " " + on.text.slice(0, 120));

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("PUT off read back {feature: read_aloud, enabled: false}; today listed the three features in the shared row, read_aloud off; four bad asks 400; PUT on read back true");
});
