// protects: server/modules/gemini-meter/gemini-rates.ts, server/modules/gemini-meter/gemini-meter.service.ts, server/modules/voice/voice-settings.ts
// writes: none
//
// The meter prices what it can and says what it cannot. gemini-rates.ts holds a dated rate in force today for each
// model voice settings name by default (the backup transcriber's audio input priced; the speech model's audio output
// and its audio tokens a second, which seam 7 needs to count an unmetered sentence); costOf of an unknown model is
// null. Through the usage door on a scratch database: a metered call on the speech model reads a positive estimate, a
// call on an unknown model reads cost_usd null and names the model in unpriced_models (adding no dollars), and an
// answered call with no usage counts in unmeasured_calls.

import { broken, held, runCase } from "../lib/case.mjs";
import { addUser, meterDoor, meterGround, todayUtc } from "../lib/gemini_meter.mjs";

const UNKNOWN = "case-unknown-model-q";
const KEY = { keyId: "c0ffee01", keyTail: "Rt4P" };
const firstLine = (error: unknown) => String((error as Error)?.message ?? error).split("\n")[0];
const priced = (value: unknown, positive: boolean) => typeof value === "number" && Number.isFinite(value) && (positive ? value > 0 : value >= 0);

runCase(async (t: any) => {
  const ground = await meterGround(t, "gemini-meter-rates");
  let rates: any;
  try {
    rates = await import("../../server/modules/gemini-meter/gemini-rates.ts");
  } catch (error) {
    return broken("server/modules/gemini-meter/gemini-rates.ts would not load — " + firstLine(error));
  }
  const table = Object.values(rates).find((v: any) => Array.isArray(v) && v.length > 0 && v.every((r: any) => r && typeof r.model === "string" && "from" in r)) as any[] | undefined;
  if (!table) return broken("gemini-rates.ts exports no list of { model, from, ... } rates");

  const wrong: string[] = [];
  const id = addUser(ground.db, "case-meter-rates");
  const { readVoiceSettings } = await import("../../server/modules/voice/voice-settings.ts");
  const named = readVoiceSettings(id).gemini;
  const today = todayUtc();
  const inForce = (model: string) => table
    .filter((r) => r.model === model && typeof r.from === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.from) && r.from.slice(0, 10) <= today)
    .sort((a, b) => (a.from < b.from ? 1 : -1))[0];
  const roles: [string, string][] = [["transcription", named.transcriptionModel], ["speech", named.speechModel]];
  for (const [role, model] of roles) {
    const rate = inForce(model);
    if (!rate) {
      wrong.push("no dated rate in force today for the " + role + " model " + model);
      continue;
    }
    if (!priced(rate.textInPerM, false) || !priced(rate.textOutPerM, false)) wrong.push(model + "'s text prices are not numbers");
    if (role === "transcription" && !priced(rate.audioInPerM, true)) wrong.push(model + " has no audio input price");
    if (role === "speech" && (!priced(rate.audioOutPerM, true) || !priced(rate.audioOutTokensPerSecond, true))) wrong.push(model + " has no audio output price or audio tokens a second");
  }
  if (typeof rates.costOf !== "function") wrong.push("gemini-rates.ts exports no costOf");
  else {
    const row = { model: UNKNOWN, usage_date: today, date: today, calls: 1, metered_calls: 1, input_tokens: 1000, output_tokens: 1000, input_audio_tokens: 0, output_audio_tokens: 0, inputTokens: 1000, outputTokens: 1000, inputAudioTokens: 0, outputAudioTokens: 0 };
    let cost: unknown;
    try {
      cost = rates.costOf(row);
    } catch (error) {
      cost = "threw " + firstLine(error);
    }
    if (cost !== null) wrong.push("costOf of an unknown model answered " + JSON.stringify(cost) + ", not null");
  }

  if (!ground.meter) return broken([...wrong, ground.missing].join("; "));
  const meter = ground.meter as any;
  const door = await meterDoor(t, ground);
  if (!door || typeof meter.recordGeminiCall !== "function") return broken([...wrong, "the gemini-meter barrel has no router or no recordGeminiCall"].join("; "));
  const usage = { inputTokens: 1000, outputTokens: 2000, inputAudioTokens: 0, outputAudioTokens: 2000 };
  await meter.recordGeminiCall(id, { feature: "companion_speech", model: named.speechModel, ...KEY, failed: false, usage, metered: true });
  await meter.recordGeminiCall(id, { feature: "read_aloud", model: UNKNOWN, ...KEY, failed: false, usage, metered: true });
  await meter.recordGeminiCall(id, { feature: "backup_transcription", model: named.transcriptionModel, ...KEY, failed: false, usage: null, metered: false });
  const answer = await door("GET", "/usage?range=today", id);
  if (answer.status !== 200) return broken([...wrong, "GET usage?range=today answered " + answer.status + " " + answer.text.slice(0, 120)].join("; "));
  const body = answer.json ?? {};
  const features: any[] = Array.isArray(body.features) ? body.features : [];
  const row = (f: string) => features.find((r) => r?.feature === f) ?? {};
  if (!priced(row("companion_speech").cost_usd, true)) wrong.push("a metered call on " + named.speechModel + " reads cost_usd " + JSON.stringify(row("companion_speech").cost_usd));
  if (row("read_aloud").cost_usd !== null) wrong.push("a call on an unknown model reads cost_usd " + JSON.stringify(row("read_aloud").cost_usd) + ", not null");
  if (!Array.isArray(row("read_aloud").models) || !row("read_aloud").models.includes(UNKNOWN)) wrong.push("read_aloud's models do not name " + UNKNOWN);
  if (!Array.isArray(body.unpriced_models) || !body.unpriced_models.includes(UNKNOWN)) wrong.push("unpriced_models " + JSON.stringify(body.unpriced_models) + " does not name " + UNKNOWN);
  if (row("backup_transcription").calls !== 1 || row("backup_transcription").unmeasured_calls !== 1) wrong.push("an answered call with no usage reads calls " + row("backup_transcription").calls + ", unmeasured_calls " + row("backup_transcription").unmeasured_calls);
  const sum = features.map((r) => r?.cost_usd).filter((c) => typeof c === "number").reduce((a, b) => a + b, 0);
  if (typeof body.cost_usd !== "number" || Math.abs(body.cost_usd - sum) > 1e-9) wrong.push("the total cost_usd " + JSON.stringify(body.cost_usd) + " is not the sum of the priced rows " + sum);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("rates in force for " + named.transcriptionModel + " and " + named.speechModel + "; unknown model -> costOf null, cost_usd null, unpriced; speech call $" + row("companion_speech").cost_usd + "; the unmeasured call counted; total = sum of priced rows");
});
