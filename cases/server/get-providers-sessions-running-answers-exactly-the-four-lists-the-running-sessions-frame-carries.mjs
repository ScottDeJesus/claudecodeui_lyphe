// protects: server/modules/providers/provider.routes.ts, server/modules/providers/services/running-sessions.lane.ts, server/modules/providers/services/session-subagent-runs.service.ts, server/shared/types.ts
// writes: none
// The route and the frame are one answer (pollers-hooks--client-pushes, seam 7): GET /api/providers/sessions/running reads
// it through readRunningSessions(), and running_sessions_state spreads the same four lists beside { kind, at }. With the
// checks token the route answers 200 whose data holds exactly sessions, subagentSessionIds, subagentModels and
// awaitingInputSessionIds, each session naming its sessionId, and subagentModels keyed by exactly the subagentSessionIds.

import { api } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const ROUTE = "/api/providers/sessions/running";
const KEYS = "awaitingInputSessionIds,sessions,subagentModels,subagentSessionIds";
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

runCase(async () => {
  const answer = await api(ROUTE);
  if (answer.status !== 200) return broken("GET " + ROUTE + " with the checks token answered " + answer.status + ", not 200");
  const json = answer.json;
  const data = json && typeof json === "object" && "data" in json ? json.data : json;
  if (!data || typeof data !== "object" || Array.isArray(data)) return broken("GET " + ROUTE + " answered no object of lists: " + JSON.stringify(json).slice(0, 120));
  const keys = Object.keys(data).sort().join(",");
  if (keys !== KEYS) return broken("GET " + ROUTE + " answered the keys " + keys + ", not " + KEYS);
  if (!Array.isArray(data.sessions) || data.sessions.some((run) => !run || typeof run.sessionId !== "string")) return broken("sessions is not a list of runs each naming a string sessionId");
  if (!strings(data.subagentSessionIds) || !strings(data.awaitingInputSessionIds)) return broken("subagentSessionIds or awaitingInputSessionIds is not a list of strings");
  const models = data.subagentModels;
  if (!models || typeof models !== "object" || Array.isArray(models) || Object.values(models).some((list) => !strings(list))) return broken("subagentModels is not a map of string lists");
  const modelIds = JSON.stringify(Object.keys(models).sort());
  const agentIds = JSON.stringify([...data.subagentSessionIds].sort());
  if (modelIds !== agentIds) return broken("subagentModels is keyed by " + modelIds + " while subagentSessionIds is " + agentIds);
  return held("GET " + ROUTE + ": the four lists, " + data.sessions.length + " runs, " + data.subagentSessionIds.length + " with agents out (models for each), " + data.awaitingInputSessionIds.length + " waiting");
});
