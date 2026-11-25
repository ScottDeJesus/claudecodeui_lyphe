// protects: server/modules/gemini-meter/, server/modules/database/repositories/gemini-*
// writes: none
//
// The meter reads one account. Two accounts on a scratch database each have one recorded call, on different features
// and keys, and the first has read_aloud switched off; GET /usage?range=today as each counts only that account's call,
// lists only that account's counted key, and only the first reads read_aloud off.

import { broken, held, runCase } from "../lib/case.mjs";
import { addUser, meterDoor, meterGround } from "../lib/gemini_meter.mjs";

const USAGE = { inputTokens: 100, outputTokens: 50, inputAudioTokens: 100, outputAudioTokens: 0 };

runCase(async (t: any) => {
  const ground = await meterGround(t, "gemini-meter-accounts");
  if (!ground.meter) return broken(ground.missing);
  const meter = ground.meter as any;
  const door = await meterDoor(t, ground);
  if (!door || typeof meter.recordGeminiCall !== "function") return broken("the gemini-meter barrel has no router or no recordGeminiCall");
  const first = addUser(ground.db, "case-meter-first");
  const second = addUser(ground.db, "case-meter-second");
  await meter.recordGeminiCall(first, { feature: "companion_speech", model: "gemini-3.8-flash-tts", keyId: "aaaa1111", keyTail: "Qa7A", failed: false, usage: USAGE, metered: true });
  await meter.recordGeminiCall(second, { feature: "backup_transcription", model: "gemini-3.8-flash", keyId: "bbbb2222", keyTail: "Qb7B", failed: false, usage: USAGE, metered: true });
  const off = await door("PUT", "/switches/read_aloud", first, { enabled: false });
  if (off.status !== 200) return broken("PUT read_aloud off for the first account answered " + off.status + " " + off.text.slice(0, 120));

  const wrong: string[] = [];
  const views: [string, number, string, string, string, boolean][] = [
    ["first", first, "companion_speech", "Qa7A", "Qb7B", false],
    ["second", second, "backup_transcription", "Qb7B", "Qa7A", true],
  ];
  for (const [who, id, own, ownKey, otherKey, readAloudOn] of views) {
    const answer = await door("GET", "/usage?range=today", id);
    if (answer.status !== 200) {
      wrong.push("the " + who + " account's GET answered " + answer.status);
      continue;
    }
    const body = answer.json ?? {};
    const features: any[] = Array.isArray(body.features) ? body.features : [];
    const row = (f: string) => features.find((r) => r?.feature === f) ?? {};
    if (body.calls !== 1) wrong.push("the " + who + " account's total reads " + body.calls + " calls, not 1");
    for (const f of ["companion_speech", "read_aloud", "backup_transcription"]) {
      const want = f === own ? 1 : 0;
      if (row(f).calls !== want) wrong.push("the " + who + " account reads " + f + " calls " + row(f).calls + ", not " + want);
    }
    if (row("read_aloud").enabled !== readAloudOn) wrong.push("the " + who + " account reads read_aloud enabled " + row("read_aloud").enabled);
    const keys: any[] = Array.isArray(body.keys) ? body.keys : [];
    const mine = keys.find((k) => k?.key === ownKey);
    if (!mine || mine.calls !== 1) wrong.push("the " + who + " account's keys do not list its own key " + ownKey + " with 1 call");
    if (keys.some((k) => k?.key === otherKey) || answer.text.includes(otherKey)) wrong.push("the " + who + " account's answer names the other account's key " + otherKey);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("each account's today read 1 call on its own feature, its own key only, and read_aloud off only for the account that switched it");
});
