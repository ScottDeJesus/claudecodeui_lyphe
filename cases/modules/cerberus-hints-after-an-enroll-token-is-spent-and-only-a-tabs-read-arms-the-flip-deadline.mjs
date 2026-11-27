// protects: server/modules/cerberus/warden-enrollment.ts, server/modules/cerberus/cerberus.routes.ts, server/shared/cerberus-types.ts, server/modules/cerberus/cerberus-broadcast.ts
// writes: none
// WHO HINTS AND WHO ARMS. A spent enrollment token writes a row the Enroll dialog cannot otherwise hear: enrollNode
// calls hintChanged after the markUsed transaction commits, and only when the token was spent. Time is armed only by
// a tab's read: GET /overview and GET /checks/:node/:service/:id each hand collectFlips' flipsAt to the read model and
// armFlipDeadline(flips.earliest()) after it; the routes register the judge (judgeFlipsWith); CerberusReadInputs
// carries flipsAt?; and no other server file calls armFlipDeadline, so the module's own overview() (auto-diagnosis)
// never arms it. A reading of the source as it stands, comments stripped.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const ENROLL = "server/modules/cerberus/warden-enrollment.ts";
const ROUTES = "server/modules/cerberus/cerberus.routes.ts";
const TYPES = "server/shared/cerberus-types.ts";
const ARMERS = new Set(["server/modules/cerberus/cerberus.routes.ts", "server/modules/cerberus/cerberus-broadcast.ts"]);

const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { return null; }
}

function sourcesUnder(dir, found = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") sourcesUnder(full, found); }
    else if (/\.(ts|js|mjs)$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** The GET route of cerberus.routes.ts whose handler calls marker: its path and its text up to the next route. */
function handler(code, marker) {
  const parts = code.split(/(?=router\.(?:get|post|put|delete|patch)\s*\()/);
  const part = parts.find((p) => /^router\.get\s*\(/.test(p) && p.includes(marker));
  if (!part) return null;
  const route = (part.match(/^router\.get\s*\(\s*['"]([^'"]+)['"]/) || [])[1] || "?";
  return { route, body: part };
}

runCase(async () => {
  const wrong = [];
  const enrollText = read(ENROLL);
  const routesText = read(ROUTES);
  const typesText = read(TYPES);
  if (enrollText === null || routesText === null || typesText === null) return broken("one of " + [ENROLL, ROUTES, TYPES].join(", ") + " is not there");

  const enroll = codeOf(enrollText);
  const body = enroll.slice(Math.max(0, enroll.indexOf("export function enrollNode")));
  const spend = body.indexOf("markUsed(");
  const commit = spend < 0 ? -1 : body.indexOf(".immediate()", spend);
  const spentGuard = commit < 0 ? -1 : body.indexOf("if (!spent)", commit);
  const hint = commit < 0 ? -1 : body.indexOf("hintChanged(", commit);
  if (spend < 0) wrong.push("enrollNode spends no token (no markUsed)");
  else if (hint < 0) wrong.push("enrollNode sends no hint after the token's spend commits");
  else if (spentGuard < 0 || spentGuard > hint) wrong.push("enrollNode hints before it knows the token was spent");

  const routes = codeOf(routesText);
  const reads = [["GET /overview (buildOverview)", handler(routes, "buildOverview(")], ["GET the check sheet (checkDetail)", handler(routes, "checkDetail(")]];
  for (const [label, h] of reads) {
    if (h === null) { wrong.push("cerberus.routes.ts has no " + label); continue; }
    if (!/collectFlips\s*\(/.test(h.body)) wrong.push(label + " " + h.route + " makes no flip collector");
    if (!/flipsAt\s*:\s*flips\.flipsAt/.test(h.body)) wrong.push(label + " " + h.route + " hands the read model no flipsAt");
    if (!/armFlipDeadline\s*\(\s*flips\.earliest\s*\(\s*\)\s*\)/.test(h.body)) wrong.push(label + " " + h.route + " does not arm armFlipDeadline with the read's earliest instant");
  }
  if (!/judgeFlipsWith\s*\(/.test(routes)) wrong.push("the routes register no flip judge (judgeFlipsWith)");
  if (!/export type CerberusReadInputs\s*=\s*\{[\s\S]*?flipsAt\?\s*:\s*\(\s*at\s*:\s*number\s*\)\s*=>\s*void/.test(typesText)) wrong.push("CerberusReadInputs carries no flipsAt?: (at: number) => void");

  for (const file of sourcesUnder(path.join(ROOT, "server"))) {
    const rel = path.relative(ROOT, file);
    if (ARMERS.has(rel)) continue;
    if (/armFlipDeadline\s*\(/.test(codeOf(fs.readFileSync(file, "utf8")))) wrong.push(rel + " arms the flip deadline: only a tab's read may");
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("enrollNode hints after the spend commits and only when spent; GET " + reads.map(([, h]) => h.route).join(" and GET ") + " hand flipsAt to the read model and arm armFlipDeadline(flips.earliest()); the routes register the judge; CerberusReadInputs carries flipsAt?; no other server file arms it");
});
