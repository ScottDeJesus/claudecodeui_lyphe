// protects: server/modules/gemini-usage/, server/shared/shadow-connector-lane.ts, server/shared/shadow-connector-lane-router.ts
// writes: none
//
// The gemini-usage lane forwards its two allowlist rows and nothing else, with the secret it reads from the env file, and
// passes bodies whole both ways (INV-8633 rules 3 to 5). createGeminiUsageModule() is built with SHADOW_CONNECTOR_URL at a
// stub engine on loopback and SHADOW_CONNECTOR_ENV_FILE at a scratch env file, its router served on a loopback express app
// (sign-in is the mount's, in server/index.ts). The engine must be asked GET /api/gemini-usage/usage?range=7d and
// PUT /api/gemini-usage/switches/probe_feature with the browser's body byte for byte, each carrying the file's secret in a
// header; its answers (a 409 too) reach the browser status and body whole, the secret never. A bad range, a bad feature
// key, other paths and methods forward nothing; an undeclared query key never reaches the engine; a second module over a
// missing env file forwards nothing and warns under its own label, [gemini-usage]. Nothing real is reached.

import http from "node:http";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const MODULE = "../../server/modules/gemini-usage/index.ts";
const SECRET = "case-lane-secret-5d81c2";
const USAGE_BODY = { account_id: "case", range: "7d", total_usd: 1.5, projects: [{ project: "shadowconnector", features: [{ feature: "probe_feature", label: "Probe — ünïcode", enabled: true }] }], a_key_the_lane_must_not_drop: { nested: [1, null, "x"] } };
const REFUSED_BODY = { detail: "accounts() holds two accounts: name one" };
const firstLine = (error: unknown) => String((error as Error)?.message ?? error).split("\n")[0];

runCase(async (t: any) => {
  const folder = await scratchDir(t, "gemini-usage-lane");
  const envFile = path.join(folder, "connector.env");
  await writeFile(envFile, "PG_HOST=127.0.0.1\nEIS_INTERNAL_SECRET=" + SECRET + "\n");

  const seen: { method?: string; url?: string; headers: http.IncomingHttpHeaders; raw: string }[] = [];
  const engine = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      seen.push({ method: request.method, url: request.url, headers: request.headers, raw });
      const url = new URL(request.url ?? "/", "http://engine");
      let status = 404;
      let body: unknown = { detail: "Not Found" };
      if (request.method === "GET" && url.pathname === "/api/gemini-usage/usage") {
        [status, body] = url.searchParams.get("range") === "30d" ? [409, REFUSED_BODY] : [200, USAGE_BODY];
      } else if (request.method === "PUT" && url.pathname.startsWith("/api/gemini-usage/switches/")) {
        status = 200;
        body = { feature: decodeURIComponent(url.pathname.split("/").pop() ?? ""), enabled: false, account_id: "acct-x", echoed: raw };
      }
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => engine.listen(0, "127.0.0.1", () => resolve()));
  t.defer(() => new Promise<void>((resolve) => {
    engine.closeAllConnections?.();
    engine.close(() => resolve());
  }));

  const saved = { url: process.env.SHADOW_CONNECTOR_URL, file: process.env.SHADOW_CONNECTOR_ENV_FILE };
  let lane: any;
  let good: any;
  let blind: any;
  try {
    process.env.SHADOW_CONNECTOR_URL = "http://127.0.0.1:" + (engine.address() as { port: number }).port;
    process.env.SHADOW_CONNECTOR_ENV_FILE = envFile;
    try {
      lane = await import(MODULE);
    } catch (error) {
      return broken("server/modules/gemini-usage/index.ts would not load — " + firstLine(error));
    }
    if (typeof lane.createGeminiUsageModule !== "function") return broken("the gemini-usage barrel exports no createGeminiUsageModule");
    good = lane.createGeminiUsageModule();
    process.env.SHADOW_CONNECTOR_ENV_FILE = path.join(folder, "no-such.env");
    blind = lane.createGeminiUsageModule();
  } finally {
    if (saved.url === undefined) delete process.env.SHADOW_CONNECTOR_URL;
    else process.env.SHADOW_CONNECTOR_URL = saved.url;
    if (saved.file === undefined) delete process.env.SHADOW_CONNECTOR_ENV_FILE;
    else process.env.SHADOW_CONNECTOR_ENV_FILE = saved.file;
  }

  const { default: express } = await import("express");
  const serve = async (router: any) => {
    const app = express();
    app.use(express.json());
    app.use("/api/gemini-usage", router);
    const server = await new Promise<http.Server>((resolve, reject) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      listening.on("error", reject);
    });
    t.defer(() => new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }));
    return "http://127.0.0.1:" + (server.address() as { port: number }).port + "/api/gemini-usage";
  };
  const call = async (origin: string, method: string, route: string, body?: unknown) => {
    const response = await fetch(origin + route, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, text, json };
  };

  const wrong: string[] = [];
  const origin = await serve(good.router);

  const usage = await call(origin, "GET", "/usage?range=7d");
  if (usage.status !== 200 || usage.text !== JSON.stringify(USAGE_BODY)) wrong.push("GET /usage?range=7d answered " + usage.status + " " + usage.text.slice(0, 160) + ", not the engine's body whole");
  if (usage.text.includes(SECRET)) wrong.push("the secret came back to the browser");
  const asked = seen.find((s) => s.method === "GET");
  if (!asked || asked.url !== "/api/gemini-usage/usage?range=7d") wrong.push("the engine was asked " + JSON.stringify(asked?.url) + " for the 7d read, not /api/gemini-usage/usage?range=7d");
  if (asked && !Object.values(asked.headers).some((value) => value === SECRET)) wrong.push("the 7d read reached the engine with no header carrying the env file's secret");

  const refused = await call(origin, "GET", "/usage?range=30d");
  if (refused.status !== 409 || refused.text !== JSON.stringify(REFUSED_BODY)) wrong.push("the engine's 409 came back as " + refused.status + " " + refused.text.slice(0, 120));

  const sent = { enabled: false, account_id: "acct-x", note: { why: "case", list: [1, 2] } };
  const put = await call(origin, "PUT", "/switches/probe_feature", sent);
  const pressed = seen.find((s) => s.method === "PUT");
  if (!pressed || pressed.url !== "/api/gemini-usage/switches/probe_feature" || pressed.raw !== JSON.stringify(sent)) {
    wrong.push("the switch reached the engine as " + JSON.stringify(pressed ? [pressed.url, pressed.raw] : null) + ", not PUT /api/gemini-usage/switches/probe_feature with the body whole");
  }
  if (put.status !== 200 || put.json?.echoed !== JSON.stringify(sent) || put.json?.account_id !== "acct-x") wrong.push("the switch's answer came back as " + put.status + " " + put.text.slice(0, 160));

  const forwarded = seen.length;
  const refusals: [string, string, string, unknown, number][] = [
    ["range=year", "GET", "/usage?range=year", undefined, 422],
    ["a feature key with capitals and a dash", "PUT", "/switches/Bad-Key", { enabled: true }, 422],
    ["an 81-character feature key", "PUT", "/switches/" + "a".repeat(81), { enabled: true }, 422],
    ["a path outside the allowlist", "GET", "/nothing", undefined, 404],
    ["POST on the usage read", "POST", "/usage?range=7d", {}, 404],
    ["DELETE on a switch", "DELETE", "/switches/probe_feature", undefined, 404],
    ["GET on a switch", "GET", "/switches/probe_feature", undefined, 404],
  ];
  for (const [what, method, route, body, want] of refusals) {
    const answer = await call(origin, method, route, body);
    if (answer.status !== want) wrong.push(what + " answered " + answer.status + ", not " + want);
    else if (want === 404 && answer.json?.error !== "not a route of the gemini-usage lane") wrong.push(what + "'s 404 reads " + answer.text.slice(0, 100));
  }
  if (seen.length !== forwarded) wrong.push("the refusals forwarded " + (seen.length - forwarded) + " request(s): " + seen.slice(forwarded).map((s) => s.method + " " + s.url).join(", "));

  const beforeExtra = seen.length;
  const extra = await call(origin, "GET", "/usage?range=7d&account_id=acct-x&debug=1");
  const extraSeen = seen.slice(beforeExtra);
  if (extraSeen.some((s) => s.url !== "/api/gemini-usage/usage?range=7d")) wrong.push("an undeclared query key reached the engine: " + extraSeen.map((s) => s.url).join(", "));

  const warns: string[] = [];
  const warn = console.warn;
  console.warn = (...parts: unknown[]) => {
    warns.push(parts.join(" "));
  };
  let dark: { status: number; text: string; json: any };
  const beforeDark = seen.length;
  try {
    dark = await call(await serve(blind.router), "GET", "/usage?range=7d");
  } finally {
    console.warn = warn;
  }
  if (seen.length !== beforeDark) wrong.push("with no env file the lane still reached the engine");
  if (dark.status < 500 || typeof dark.json?.error !== "string") wrong.push("with no env file the read answered " + dark.status + " " + dark.text.slice(0, 120) + ", not a lane fault");
  if (!warns.some((line) => line.startsWith("[gemini-usage] "))) wrong.push("the missing env file was not warned under [gemini-usage] (warned " + JSON.stringify(warns).slice(0, 160) + ")");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("7d and the switch forwarded to /api/gemini-usage with the secret and the bodies whole, 409 relayed whole; 7 refusals forwarded nothing; undeclared query keys answered " + extra.status + " and never reached the engine; a missing env file answered " + dark.status + " and warned [gemini-usage]");
});
