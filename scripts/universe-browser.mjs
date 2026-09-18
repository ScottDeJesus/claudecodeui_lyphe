#!/usr/bin/env node
// The headless-browser driver the universe probes walk the app with: start chrome-headless-shell,
// speak the DevTools protocol over a plain websocket, and hand back a tab to ask questions in.
//
// It is a sibling of the probes rather than part of one because the two concerns change for
// different reasons: everything in this file is about CHROME (the binary, its port, its process
// group, the protocol's request/reply shape), and everything in `universe-ui-probe.mjs` is about the
// APP (its origin, its token, its tab strip, its canvas). A probe that has to be re-read because the
// browser's launch flags moved is a probe whose actual subject is buried.
//
// WHY NOT PLAYWRIGHT. Driving the protocol by hand keeps `ws` the only dependency and keeps a test
// runner out of a repo whose rule is that the real system is the test.
//
// The chrome-headless-shell binary is playwright's own download, already on this box; point
// CHROME_HEADLESS_SHELL somewhere else to use a different one.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import WebSocket from 'ws';

export const SHELL = process.env.CHROME_HEADLESS_SHELL
  || path.join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');

/** How long any single wait — the browser's port, the app's first paint, one element — may take. */
export const WAIT_MS = 30_000;
export const POLL_MS = 200;
/** How long to wait for a killed browser to actually be gone before answering anyway. */
const STOP_GRACE_MS = 2_000;

/**
 * A DevTools protocol client over a plain websocket, with just enough of the protocol: one id per
 * message, a promise per id, events dropped. `sessionId` turns a browser-level socket into one that
 * addresses a single tab, which is what the flattened attach hands back.
 */
export class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();

    socket.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return; // a frame that is not JSON is not a reply to anything
      }
      if (message.id === undefined) return; // an event; the probes poll rather than subscribe
      const settle = this.pending.get(message.id);
      if (!settle) return;
      this.pending.delete(message.id);
      if (message.error) settle.reject(new Error(`${message.error.message} (${message.error.code})`));
      else settle.resolve(message.result);
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

/**
 * Starts the shell with its debugging port picked by the browser itself and reported in
 * `DevToolsActivePort` inside the profile directory. Choosing a port here would be a race against
 * every other thing on the box; asking the browser to choose one and reading it back is not.
 */
export async function launchBrowser() {
  const dir = await mkdtemp(path.join(tmpdir(), 'universe-ui-probe-'));
  const child = spawn(SHELL, [
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--window-size=1280,900',
    '--remote-debugging-port=0',
    `--user-data-dir=${dir}`,
    'about:blank',
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  // A binary that is missing, or not executable, fails by EMITTING rather than throwing. Without
  // this the loop below would spend its whole window waiting for a port from a process that was
  // never born, and the phase would pay thirty seconds to be told the path is wrong.
  let spawnError = null;
  child.once('error', (error) => {
    spawnError = error;
  });

  const portFile = path.join(dir, 'DevToolsActivePort');
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until && !spawnError) {
    try {
      const [line] = (await readFile(portFile, 'utf8')).split('\n');
      if (Number(line) > 0) return { child, dir, port: Number(line) };
    } catch {
      // The file appears once the browser is listening; before that there is nothing to read.
    }
    await delay(POLL_MS);
  }

  // The browser we started is ours to shut down even though it never became usable.
  await stopChild(child);
  await rm(dir, { recursive: true, force: true });
  throw new Error(spawnError
    ? `could not start ${SHELL}: ${spawnError.message}`
    : `${SHELL} reported no debugging port within ${WAIT_MS}ms`);
}

/**
 * Kills the browser and every child it forked. The negative pid addresses the process GROUP, which
 * `detached` made this child the leader of: killing the leader alone orphans a dozen renderers — and
 * a signal is DELIVERED rather than applied, so the wait for it is bounded rather than skipped.
 */
async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return; // already reaped

  const gone = once(child, 'exit').catch(() => {});
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone; nothing to reap.
    }
  }
  await Promise.race([gone, delay(STOP_GRACE_MS)]);
}

/** Closes the tab, the browser and the profile it wrote. A probe leaves no running process behind. */
export async function closeBrowser({ child, dir }) {
  await stopChild(child);
  await rm(dir, { recursive: true, force: true });
}

/** The browser-level protocol socket, found through the port the browser reported. */
export async function connectBrowser(port) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const socket = new WebSocket(webSocketDebuggerUrl);
  await once(socket, 'open');
  return new Cdp(socket);
}

/**
 * A tab of the probe's own, navigated to `url` — so it never fights whatever the app already had
 * open — and the session that addresses it. `about:blank` first, because a url that fails to load
 * still leaves a tab this probe can ask about itself.
 */
export async function openTab(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  return sessionId;
}

/** Runs one expression in the page and returns its value. */
export async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);

  if (result.exceptionDetails) {
    // `description` carries the thrown error's own message; the bare `text` on a rejection is just
    // "Uncaught", which tells the next reader nothing about what the page refused.
    const details = result.exceptionDetails;
    throw new Error(details.exception?.description ?? details.text ?? 'the page threw');
  }
  return result.result.value;
}

/**
 * Polls an expression until it is truthy. A throw is not a failure but an answer — during a
 * navigation the document being asked belongs to the page that is leaving, and there is no execution
 * context to evaluate in until the next one exists.
 */
export async function waitFor(cdp, sessionId, expression, timeoutMs = WAIT_MS) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if (await evaluate(cdp, sessionId, expression)) return true;
    } catch {
      // No context to ask in yet; the next poll asks again.
    }
    await delay(POLL_MS);
  }
  return false;
}
