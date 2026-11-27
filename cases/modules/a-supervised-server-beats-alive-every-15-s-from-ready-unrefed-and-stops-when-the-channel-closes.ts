// protects: server/supervised-boot.ts
// writes: none
// A supervised API beats: signalReady() sends ready and starts one alive every 15 s, its timer unref'ed so it never holds the
// process open, each beat sent only while the channel is connected; an unsupervised one starts no beat. Judged on a stand-in
// channel (process.send and process.connected) and a stand-in setInterval, both put back before the verdict.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const BOOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/supervised-boot.ts");

type Beat = { fn: () => void; ms: number; unrefed: boolean; cleared: boolean };

runCase(async () => {
  const proc = process as any;
  const hadSend = Object.prototype.hasOwnProperty.call(proc, "send");
  const oldSend = proc.send;
  const oldConnected = Object.getOwnPropertyDescriptor(proc, "connected");
  const oldEnv = process.env.CLOUDCLI_SUPERVISED;
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const sent: any[] = [];
  const beats: Beat[] = [];
  let connected = true;
  const fakeTimers = () => {
    (globalThis as any).setInterval = (fn: () => void, ms: number) => {
      const beat: any = { fn, ms, unrefed: false, cleared: false };
      beat.unref = () => { beat.unrefed = true; return beat; };
      beat.ref = () => beat;
      beat.hasRef = () => !beat.unrefed;
      beats.push(beat);
      return beat;
    };
    (globalThis as any).clearInterval = (beat: any) => { if (beats.includes(beat)) beat.cleared = true; else realClearInterval(beat); };
  };
  const realTimers = () => { globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval; };
  proc.send = (message: unknown, callback?: (error: Error | null) => void) => { sent.push(message); callback?.(null); return true; };
  Object.defineProperty(proc, "connected", { configurable: true, get: () => connected });
  try {
    process.env.CLOUDCLI_SUPERVISED = "1";
    let boot: any;
    try {
      boot = await import(pathToFileURL(BOOT).href);
    } catch (error: any) {
      return cannotRun(BOOT + " would not load: " + String(error?.message ?? error).split("\n")[0]);
    }
    if (boot.supervised !== true) return cannotRun("supervised-boot.ts did not read the stand-in channel as supervised");
    fakeTimers();
    try { boot.signalReady(); } finally { realTimers(); }
    const wrong: string[] = [];
    const readies = sent.filter((message) => message?.type === "ready").length;
    if (readies !== 1) wrong.push("signalReady sent " + readies + " ready messages, wanted 1");
    if (beats.length !== 1) return broken("signalReady started " + beats.length + " interval timers, wanted one beat; sent " + JSON.stringify(sent));
    const beat = beats[0];
    if (beat.ms !== 15000) wrong.push("the beat runs every " + beat.ms + " ms, wanted 15000");
    if (!beat.unrefed) wrong.push("the beat's timer is not unref'ed");
    const before = sent.length;
    beat.fn();
    beat.fn();
    const ticks = JSON.stringify(sent.slice(before));
    if (ticks !== '[{"type":"alive"},{"type":"alive"}]') wrong.push("two ticks sent " + ticks + ", wanted two { type: 'alive' }");
    connected = false;
    const closedAt = sent.length;
    beat.fn();
    if (sent.length !== closedAt) wrong.push("a tick with the channel closed still sent " + JSON.stringify(sent.slice(closedAt)));

    let plain = "not judged: a second copy of the module would not load";
    connected = true;
    process.env.CLOUDCLI_SUPERVISED = "0";
    try {
      const again: any = await import(pathToFileURL(BOOT).href + "?unsupervised");
      if (again.supervised === false) {
        fakeTimers();
        try { again.signalReady(); } finally { realTimers(); }
        plain = beats.length === 1 ? "no beat" : (beats.length - 1) + " beats";
        if (beats.length !== 1) wrong.push("an unsupervised server started a beat");
      } else {
        plain = "not judged: the second copy read itself as supervised";
      }
    } catch {
      // plain says so
    }
    return wrong.length
      ? broken(wrong.join("; "))
      : held("one ready; one beat every 15000 ms, unref'ed; two ticks sent two alive; a tick on a closed channel sent nothing; unsupervised: " + plain);
  } finally {
    realTimers();
    if (hadSend) proc.send = oldSend; else delete proc.send;
    if (oldConnected) Object.defineProperty(proc, "connected", oldConnected); else delete proc.connected;
    if (oldEnv === undefined) delete process.env.CLOUDCLI_SUPERVISED; else process.env.CLOUDCLI_SUPERVISED = oldEnv;
  }
});
