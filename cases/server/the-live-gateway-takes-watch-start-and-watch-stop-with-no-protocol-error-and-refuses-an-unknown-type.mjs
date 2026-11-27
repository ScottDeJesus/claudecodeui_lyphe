// protects: server/modules/websocket/services/chat-websocket.service.ts, server/modules/websocket/services/lane-watch.service.ts
// writes: none
//
// The app's socket takes the two watch frames: watch.start and watch.stop are handed to laneWatch, so neither draws the
// gateway's UNKNOWN_MESSAGE_TYPE, whether the lane is defined (subagent_transcript, here with a soul key that has no
// record directory, which opens nothing and sends nothing) or not defined by anyone (ignored). A frame type the gateway
// does not know still draws UNKNOWN_MESSAGE_TYPE, which proves the silence is a hand-off and not a deaf socket. The
// socket is the case's own, signed in with the checks token; a watch is held in memory only and ends with the socket.

import { api, appSocketUrl } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const UNKNOWN = "watch.case-unknown-type";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t) => {
  const identity = await api("/api/auth/user");
  if (identity.status !== 200) return cannotRun("the server answered " + identity.status + " when asked who the checks token is");
  const { default: WebSocket } = await import("ws");
  const socket = new WebSocket(await appSocketUrl());
  t.defer(() => socket.terminate());
  const frames = [];
  socket.on("message", (data) => frames.push(String(data)));
  const opened = await new Promise((resolve) => {
    socket.once("open", () => resolve(true));
    socket.once("error", () => resolve(false));
    setTimeout(() => resolve(false), 5000);
  });
  if (!opened) return cannotRun("the app's socket did not open within 5 s");
  const send = (frame) => socket.send(JSON.stringify(frame));
  send({ type: "watch.start", lane: "subagent_transcript", key: "soul:case-not-a-launch-id" });
  send({ type: "watch.stop", lane: "subagent_transcript", key: "soul:case-not-a-launch-id" });
  send({ type: "watch.start", lane: "case-lane-nobody-defined", key: null });
  send({ type: "watch.stop", lane: "case-lane-nobody-defined", key: null });
  await sleep(800);
  send({ type: UNKNOWN });
  const end = Date.now() + 3000;
  while (!frames.some((f) => f.includes(UNKNOWN)) && Date.now() < end) await sleep(50);
  const refusals = frames.filter((f) => f.includes("UNKNOWN_MESSAGE_TYPE"));
  const aboutWatch = refusals.filter((f) => /watch\.(start|stop)\\?"/.test(f));
  if (aboutWatch.length > 0) return broken("the gateway refused a watch frame: " + aboutWatch[0].slice(0, 200));
  if (!refusals.some((f) => f.includes(UNKNOWN))) return broken("an unknown type drew no UNKNOWN_MESSAGE_TYPE within 3 s, so the watch frames' silence proves nothing");
  const told = frames.filter((f) => f.includes("subagent_transcript_changed"));
  if (told.length > 0) return broken("a soul key with no record directory sent " + told.length + " subagent_transcript_changed");
  return held("watch.start and watch.stop drew no refusal for a defined lane or an undefined one, and the unknown type drew UNKNOWN_MESSAGE_TYPE");
});
