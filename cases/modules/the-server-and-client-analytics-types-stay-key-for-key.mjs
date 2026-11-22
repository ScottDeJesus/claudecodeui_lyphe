// The Analytics wire types are one statement in two homes: server/shared/analytics-types.ts and its client mirror
// src/shared/analytics-types.ts hold the same declarations once comments are set aside (the rule of
// server/shared/app-types.ts: edited together, always), every type the area names is exported, the verb's
// snake_case keys are kept, and both files are on .oxlintrc.json's shared-file lists.
//
// protects: server/shared/analytics-types.ts, src/shared/analytics-types.ts, .oxlintrc.json
// writes: none

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const FILES = ["server/shared/analytics-types.ts", "src/shared/analytics-types.ts"];
const TYPES = ["AnalyticsSectionList", "AnalyticsAnswer", "CodeModeAnalytics", "CodeModeFigures", "CodeModeGroup", "CodeModeDay", "CodeModeCause"];
const KEYS = ["tokens_in", "timed_out", "first_day", "code_mode"];

const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/\s+/g, " ").trim();

runCase(async () => {
  const absent = FILES.filter((f) => !fs.existsSync(path.join(REPO, f)));
  if (absent.length > 0) return broken(`not on disk: ${absent.join(", ")}`);
  const [server, client] = FILES.map((f) => codeOf(fs.readFileSync(path.join(REPO, f), "utf8")));
  if (server !== client) {
    let i = 0;
    while (i < server.length && server[i] === client[i]) i += 1;
    return broken(`the two files part at character ${i}: server "${server.slice(Math.max(0, i - 40), i + 60)}" | client "${client.slice(Math.max(0, i - 40), i + 60)}"`);
  }
  const missingTypes = TYPES.filter((name) => !new RegExp(`export type ${name}\\b`).test(server));
  const missingKeys = KEYS.filter((key) => !new RegExp(`\\b${key}\\??:`).test(server));
  const lint = fs.readFileSync(path.join(REPO, ".oxlintrc.json"), "utf8");
  const unlisted = FILES.filter((f) => !lint.includes(`"${f}"`));
  const wrong = [];
  if (missingTypes.length > 0) wrong.push(`no export of ${missingTypes.join(", ")}`);
  if (missingKeys.length > 0) wrong.push(`no key ${missingKeys.join(", ")}`);
  if (unlisted.length > 0) wrong.push(`not in .oxlintrc.json: ${unlisted.join(", ")}`);
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`the two files hold the same ${server.length} characters of declarations, export all ${TYPES.length} types with ${KEYS.join(", ")}, and both are in .oxlintrc.json`);
});
