// protects: server/modules/gemini-meter/, server/modules/database/gemini-meter-schema.ts, server/modules/database/followups-schema.ts, server/modules/database/migrations.ts, server/modules/database/repositories/gemini-*
// writes: none
//
// A recorded Gemini call lands in ONE daily row and a switch is read when it is asked. On a scratch database booted by
// initializeDatabase, gemini_calls_daily and gemini_feature_switches carry the design's columns, primary keys and their
// cascade from users; four recordGeminiCall calls on one feature, model and key (two metered, one failed, one answered
// with no usage) leave one row for the UTC day; geminiFeatureOff reads false with no row and follows a row written under
// it at the next ask; deleting the account takes its rows; a call whose write fails throws nothing and logs exactly one
// console.warn naming the error's class. The real database is never opened.

import { broken, held, runCase } from "../lib/case.mjs";
import { addUser, meterGround, todayUtc } from "../lib/gemini_meter.mjs";

const CALLS_COLUMNS = ["user_id", "usage_date", "feature", "model", "key_id", "key_tail", "calls", "failures", "metered_calls", "input_tokens", "output_tokens", "input_audio_tokens", "output_audio_tokens", "first_at", "last_at"];
const CALLS_KEY = ["user_id", "usage_date", "feature", "model", "key_id"];
const SWITCH_COLUMNS = ["user_id", "feature", "enabled", "updated_at"];
const SWITCH_KEY = ["user_id", "feature"];

const CALL = { feature: "read_aloud", model: "gemini-3.8-flash-tts", keyId: "ab12cd34", keyTail: "Wq7Z" };
const USAGE = { inputTokens: 10, outputTokens: 20, inputAudioTokens: 0, outputAudioTokens: 5 };

function tableShape(db: any, table: string, columns: string[], key: string[], wrong: string[]) {
  const found = db.prepare("PRAGMA table_info(" + table + ")").all() as any[];
  if (found.length === 0) {
    wrong.push("a booted database has no " + table + " table");
    return;
  }
  const names = found.map((c) => c.name).sort().join(",");
  const want = [...columns].sort().join(",");
  if (names !== want) wrong.push(table + " has columns " + names + ", not the design's " + want);
  const pk = found.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name).join(",");
  if (pk !== key.join(",")) wrong.push(table + "'s primary key is (" + pk + "), not (" + key.join(",") + ")");
  const ref = (db.prepare("PRAGMA foreign_key_list(" + table + ")").all() as any[]).find((f) => f.from === "user_id");
  if (!ref || ref.table !== "users" || (ref.to !== "id" && ref.to !== null) || String(ref.on_delete).toUpperCase() !== "CASCADE") {
    wrong.push(table + ".user_id does not reference users(id) ON DELETE CASCADE");
  }
}

runCase(async (t: any) => {
  const ground = await meterGround(t, "gemini-meter-record");
  const db = ground.db;
  const wrong: string[] = [];
  tableShape(db, "gemini_calls_daily", CALLS_COLUMNS, CALLS_KEY, wrong);
  tableShape(db, "gemini_feature_switches", SWITCH_COLUMNS, SWITCH_KEY, wrong);
  if (!ground.meter) return broken([...wrong, ground.missing].join("; "));
  const { recordGeminiCall, geminiFeatureOff } = ground.meter as any;
  if (typeof recordGeminiCall !== "function" || typeof geminiFeatureOff !== "function") {
    return broken([...wrong, "the gemini-meter barrel exports no recordGeminiCall / geminiFeatureOff"].join("; "));
  }
  if (wrong.length > 0) return broken(wrong.join("; "));

  const id = addUser(db, "case-meter-record");
  if (geminiFeatureOff(id, "read_aloud") !== false) wrong.push("geminiFeatureOff with no switch row did not read false");
  await recordGeminiCall(id, { ...CALL, failed: false, usage: USAGE, metered: true });
  await recordGeminiCall(id, { ...CALL, failed: false, usage: USAGE, metered: true });
  await recordGeminiCall(id, { ...CALL, failed: true, usage: null, metered: false });
  await recordGeminiCall(id, { ...CALL, failed: false, usage: null, metered: false });
  const rows = db.prepare("SELECT * FROM gemini_calls_daily WHERE user_id = ?").all(id) as any[];
  if (rows.length !== 1) wrong.push("four calls on one feature, model and key left " + rows.length + " rows, not 1");
  const row = rows[0] ?? {};
  const want: Record<string, unknown> = {
    usage_date: todayUtc(), feature: CALL.feature, model: CALL.model, key_id: CALL.keyId, key_tail: CALL.keyTail,
    calls: 4, failures: 1, metered_calls: 2, input_tokens: 20, output_tokens: 40, input_audio_tokens: 0, output_audio_tokens: 10,
  };
  for (const [column, value] of Object.entries(want)) {
    if (row[column] !== value) wrong.push(column + " reads " + JSON.stringify(row[column]) + ", not " + JSON.stringify(value));
  }
  if (!row.first_at || !row.last_at) wrong.push("first_at / last_at are not stamped");

  db.prepare("INSERT INTO gemini_feature_switches (user_id, feature, enabled, updated_at) VALUES (?, 'companion_speech', 0, ?)").run(id, new Date().toISOString());
  if (geminiFeatureOff(id, "companion_speech") !== true) wrong.push("a switch row written off did not read off at the next ask");
  if (geminiFeatureOff(id, "read_aloud") !== false) wrong.push("a feature with no row read off once another feature was switched off");
  db.prepare("UPDATE gemini_feature_switches SET enabled = 1 WHERE user_id = ?").run(id);
  if (geminiFeatureOff(id, "companion_speech") !== false) wrong.push("a switch row written back on still read off");

  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  const left = (db.prepare("SELECT (SELECT count(*) FROM gemini_calls_daily WHERE user_id = ?) + (SELECT count(*) FROM gemini_feature_switches WHERE user_id = ?) AS n").get(id, id) as any).n;
  if (left !== 0) wrong.push("deleting the account left " + left + " of its meter rows");

  const other = addUser(db, "case-meter-failed-write");
  db.exec("DROP TABLE gemini_calls_daily");
  const warned: string[] = [];
  const realWarn = console.warn;
  console.warn = (...parts: unknown[]) => {
    warned.push(parts.map((p) => (p instanceof Error ? p.name + ": " + p.message : String(p))).join(" "));
  };
  let threw: unknown = null;
  try {
    await recordGeminiCall(other, { ...CALL, failed: false, usage: USAGE, metered: true });
  } catch (error) {
    threw = error;
  } finally {
    console.warn = realWarn;
  }
  if (threw) wrong.push("a call whose write failed threw " + String(threw));
  if (warned.length !== 1) wrong.push("a failed write logged " + warned.length + " console.warn lines, not 1");
  else if (!/SqliteError|SQLITE_/.test(warned[0])) wrong.push("the failed write's warning names no class: " + warned[0].slice(0, 160));

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("both tables as designed with the users cascade; 4 calls -> one row calls 4, failures 1, metered_calls 2, tokens 20/40, audio out 10; the switch read at each ask; the delete took the rows; a failed write threw nothing and warned once: " + warned[0].slice(0, 80));
});
