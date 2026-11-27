// protects: server/modules/websocket/services/lane-watch.service.ts, server/modules/websocket/services/chat-websocket.service.ts
// writes: none
//
// laneWatch keeps, per socket, which lane and key it watches, and tells a lane's owner only at the edges: first when a
// lane and key gain their first socket, last when they lose their last. A socket that closes is dropped from every watch
// it held (each key it was the last on runs last); a repeated start or a stray stop runs neither hook; a lane nobody
// defined is taken (handle answers true) and ignored; any other frame type is the gateway's (handle answers false). The
// sockets are stand-ins and the lane is the case's own, defined in this process only.

import { broken, held, runCase } from "../lib/case.mjs";

const SERVICE = "../../server/modules/websocket/services/lane-watch.service.ts";
const LANE = "case-lane-watch-edges";

runCase(async () => {
  const { laneWatch }: any = await import(SERVICE);
  const firsts: Array<string | null> = [];
  const lasts: Array<string | null> = [];
  laneWatch.define(LANE, { first: (key: string | null) => firsts.push(key), last: (key: string | null) => lasts.push(key) });
  const socket = () => ({ readyState: 1, send: () => undefined });
  const a = socket();
  const b = socket();
  const frame = (type: string, key: unknown, lane: unknown = LANE) => ({ type, lane, key });
  const count = (key: string | null) => laneWatch.sockets(LANE, key).length;
  const wrong: string[] = [];
  const say = (ok: boolean, what: string) => { if (!ok) wrong.push(what); };

  say(laneWatch.handle(a, { type: "chat.send" }) === false, "handle took a chat.send frame, which is the gateway's");
  say(laneWatch.handle(a, frame("watch.start", "k1")) === true, "handle did not take watch.start");
  say(firsts.length === 1 && firsts[0] === "k1", "the first socket on k1 did not run first once: " + JSON.stringify(firsts));
  laneWatch.handle(b, frame("watch.start", "k1"));
  laneWatch.handle(a, frame("watch.start", "k1"));
  say(firsts.length === 1, "a second socket, or a repeated start, on k1 ran first again: " + JSON.stringify(firsts));
  say(count("k1") === 2, "k1 has " + count("k1") + " watching sockets, not 2");
  laneWatch.handle(a, frame("watch.stop", "k9"));
  laneWatch.handle(a, frame("watch.stop", "k1"));
  say(lasts.length === 0, "a stray stop, or a stop that left b on k1, ran last: " + JSON.stringify(lasts));
  say(count("k1") === 1, "after a's stop k1 has " + count("k1") + " sockets, not 1");
  laneWatch.handle(b, frame("watch.start", "k2"));
  laneWatch.handle(a, frame("watch.start", null));
  say(firsts.length === 3 && firsts.includes("k2") && firsts.includes(null), "k2 and the null key did not each run first once: " + JSON.stringify(firsts));
  laneWatch.drop(b);
  say(lasts.length === 2 && lasts.includes("k1") && lasts.includes("k2"), "dropping b did not run last once for k1 and for k2: " + JSON.stringify(lasts));
  say(count("k1") === 0 && count("k2") === 0, "a dropped socket is still listed as watching");
  laneWatch.handle(a, frame("watch.stop", null));
  say(lasts.length === 3 && lasts[2] === null, "the null key lost its last watcher and last did not run: " + JSON.stringify(lasts));
  const before = firsts.length;
  say(laneWatch.handle(a, frame("watch.start", "k1", "case-lane-nobody-defined")) === true, "a watch.start for a lane nobody defined was not taken");
  say(laneWatch.sockets("case-lane-nobody-defined", "k1").length === 0 && firsts.length === before, "a lane nobody defined was watched");
  laneWatch.drop(a);
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("first ran once per key's first socket (null key included), last once per key's last, a dropped socket's keys ran last, repeats and stray stops ran nothing, an undefined lane was ignored, chat.send left to the gateway");
});
