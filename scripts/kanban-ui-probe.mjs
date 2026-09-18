#!/usr/bin/env node
// Opens the real app in a real browser, walks to a tab the way a reader does, and reports whether
// the words a caller expects are actually on the screen.
//
//   node scripts/kanban-ui-probe.mjs <app-url> <token> <project-name> <tab-label> [expect...]
//
// It prints exactly one line and exits — `PROBE OK` or `PROBE FAILED` — so a caller greps the
// result instead of reading a log. Everything that explains a failure goes to stderr. Nothing is
// hard-coded: the url, the token and both names all arrive as arguments.
//
// WHY A BROWSER. The things this probe checks — that a tab renders, that a lane paints its cards,
// that a drawer opens — exist only after React has run. A curl of the endpoint would answer none
// of them. The page is driven over the DevTools protocol by hand rather than through playwright's
// own runner, which keeps `ws` the only dependency and keeps a test runner out of a repo whose
// rule is that the real system is the test.
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

const SHELL = process.env.CHROME_HEADLESS_SHELL
  || path.join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');

/** How long any single wait — the browser's port, the app's first paint, one string — may take. */
const WAIT_MS = 30_000;
/** How long the whole probe may take before it answers rather than hanging. */
const WATCHDOG_MS = 120_000;
const POLL_MS = 200;
/** How long to wait for a killed browser to actually be gone before answering anyway. */
const STOP_GRACE_MS = 2_000;

const [appUrl, token, projectName, tabLabel, ...expects] = process.argv.slice(2);

if (!appUrl || !token || !projectName || !tabLabel) {
  console.error('usage: node scripts/kanban-ui-probe.mjs <app-url> <token> <project-name> <tab-label> [expect...]');
  process.exit(2);
}

/**
 * The browser, from the moment it exists until it is shut down.
 *
 * It lives here rather than inside `main` so the watchdog can reach it. An exit taken from inside
 * a `try` — which is what `process.exit` is — runs no `finally`, so a probe that answered the
 * moment it had a verdict left a whole browser and its profile directory behind, one per run.
 * Every phase after this one runs this probe; the leak would have been one per phase, per
 * invocation, for the life of the tab.
 */
let browser = null;

/**
 * Answers `PROBE OK`/`PROBE FAILED` and leaves. The last line is the contract. This runs after
 * the browser has been shut down, never instead of it.
 */
function report(ok, reason) {
  if (reason) console.error(`kanban-ui-probe: ${reason}`);
  console.log(ok ? 'PROBE OK' : 'PROBE FAILED');
  process.exit(ok ? 0 : 1);
}

/**
 * The whole probe is on a clock: a page that never answers must still produce its one line. This
 * is the one path that cannot unwind — nothing about it settled — so it shuts the browser down
 * itself before it answers.
 */
const watchdog = setTimeout(async () => {
  if (browser) await closeBrowser(browser);
  report(false, `nothing settled within ${WATCHDOG_MS}ms`);
}, WATCHDOG_MS);
watchdog.unref();

/**
 * A DevTools protocol client over a plain websocket, with just enough of the protocol: one id per
 * message, a promise per id, events dropped. `sessionId` turns a browser-level socket into one
 * that addresses a single tab, which is what the flattened attach below hands back.
 */
class Cdp {
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
      if (message.id === undefined) return; // an event; this probe polls rather than subscribes
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
async function launchBrowser() {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-ui-probe-'));
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

  // A binary that is missing, or not executable, fails here rather than anywhere else — and it
  // fails by EMITTING, not throwing. Without this the loop below would spend its whole window
  // waiting for a port from a process that was never born, and the phase would pay thirty seconds
  // to be told the path is wrong.
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

/** Kills the browser and every child it forked — renderers, the gpu process, the utility ones. */
async function stopChild(child) {
  // Already reaped; there is nothing left to signal or wait for.
  if (child.exitCode !== null || child.signalCode !== null) return;

  const gone = once(child, 'exit').catch(() => {});

  try {
    // The negative pid addresses the process GROUP, which `detached` made this child the leader
    // of. Killing the leader alone orphans its children, and two dozen of them outlive the probe.
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone; nothing to reap.
    }
  }

  // A signal is DELIVERED, not applied: the kernel still has to tear down a dozen processes, and
  // a probe that returned the instant it sent the kill left the very next thing anyone checks —
  // "is one still running?" — to a coin toss. Bounded, so a process wedged in the kernel cannot
  // hold the probe open past its own answer.
  await Promise.race([gone, delay(STOP_GRACE_MS)]);
}

/** Closes the tab, the browser and the profile it wrote. A probe leaves no running process behind. */
async function closeBrowser({ child, dir }) {
  await stopChild(child);
  await rm(dir, { recursive: true, force: true });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

/** Runs one expression in the page and returns its value. */
async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);

  if (result.exceptionDetails) {
    // `description` carries the thrown error's own message; the bare `text` on a rejection is
    // just "Uncaught", which tells the next reader nothing about what the page refused.
    const details = result.exceptionDetails;
    throw new Error(details.exception?.description ?? details.text ?? 'the page threw');
  }

  return result.result.value;
}

/**
 * Polls an expression until it is truthy. A throw is not a failure but an answer — during a
 * navigation the document being asked belongs to the page that is leaving, and there is no
 * execution context to evaluate in until the next one exists.
 */
async function waitFor(cdp, sessionId, expression, timeoutMs = WAIT_MS) {
  const until = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < until) {
    try {
      if (await evaluate(cdp, sessionId, expression)) return true;
    } catch (error) {
      lastError = error;
    }
    await delay(POLL_MS);
  }

  if (lastError) console.error(`kanban-ui-probe: last error while waiting — ${lastError.message}`);
  return false;
}

/** The deepest visible element whose whole text is `name` — a row, never the list containing it. */
function clickByText(name) {
  return `(() => {
    const wanted = ${JSON.stringify(name)};
    const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], li, h3, p, span, div'))
      .filter((node) => node.getClientRects().length > 0 && node.textContent.trim() === wanted);
    if (nodes.length === 0) return false;
    nodes.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    nodes[0].click();
    return true;
  })()`;
}

/** Tabs carry their label as their accessible name — the attribute the harness selects them by. */
function clickTab(label) {
  return `(() => {
    const label = ${JSON.stringify(label)};
    const tab = Array.from(document.querySelectorAll('[role="tab"]'))
      .find((node) => node.getAttribute('aria-label') === label);
    if (!tab) return false;
    tab.click();
    return true;
  })()`;
}

/** What the reader can actually see. `innerText`, not `textContent`: a hidden pane says nothing. */
const VISIBLE_TEXT = 'document.body.innerText';

/** The workspace strip exists only once a project is open — the app's own "we are somewhere" signal. */
const TABS_PRESENT = 'document.querySelectorAll(\'[role="tab"]\').length > 0';

/**
 * How long to let the app settle before deciding that no project is open.
 *
 * The workspace is restored asynchronously after the reload: the shell paints first, and the
 * strip arrives a moment later. Asking the question on that first paint answered "no" for an app
 * that had a project open all along, and the probe then went looking for a project row the
 * sidebar was not showing. Waiting for the strip, and treating its absence after this window as
 * "first run", is what makes the answer the truth rather than a race.
 */
const SETTLE_MS = 10_000;

/**
 * Walks the app and returns the verdict — `{ ok, reason }`, never an exit. Leaving has to happen
 * where the browser is shut down, so that a probe that fails and a probe that passes leave the
 * box in exactly the same state: nothing running, nothing on disk.
 */
async function main() {
  try {
    // Inside the try, not before it: a shell that cannot start at all is the same news as one that
    // starts and never answers, and both have to come back as a reason rather than as a rejection
    // the top level was never built to catch. Its own failure is a stack trace where the file
    // promises a line — the one thing a caller greps for.
    const launched = await launchBrowser();
    browser = launched;

    const socket = await connect(
      (await (await fetch(`http://127.0.0.1:${launched.port}/json/version`)).json()).webSocketDebuggerUrl,
    );
    const cdp = new Cdp(socket);

    // A tab of our own, so the probe never fights whatever the app already had open.
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);

    await cdp.send('Page.navigate', { url: appUrl }, sessionId);
    if (!await waitFor(cdp, sessionId, 'document.readyState === "complete"')) {
      return { ok: false, reason: `${appUrl} never finished loading` };
    }

    // The token goes in on the app's OWN origin, which is why the navigate above comes first: on a
    // blank page localStorage belongs to nobody, and the write would be discarded.
    await evaluate(cdp, sessionId, `localStorage.setItem('auth-token', ${JSON.stringify(token)})`);
    await cdp.send('Page.reload', {}, sessionId);
    if (!await waitFor(cdp, sessionId, 'document.readyState === "complete"')) {
      return { ok: false, reason: `${appUrl} never finished reloading` };
    }

    if (!await waitFor(cdp, sessionId, 'document.body.innerText.trim().length > 0')) {
      return { ok: false, reason: 'the app painted nothing at all after the token was written and the page reloaded' };
    }

    // A strip already on screen means a project is open, and clicking one now would collapse it.
    // Only a first run, with nothing selected, has to pick one — and "is one open?" is a question
    // that has to be waited on, not asked of the first paint.
    const stripAlreadyOpen = await waitFor(cdp, sessionId, TABS_PRESENT, SETTLE_MS);

    if (!stripAlreadyOpen) {
      if (!await waitFor(cdp, sessionId, clickByText(projectName))) {
        // A password field is the app asking to sign in, which almost always means the token was
        // refused — a much more useful thing to say than "no such project", which would send the
        // next reader looking for a project that is there and a token that is not.
        const signIn = await evaluate(cdp, sessionId, 'document.querySelector(\'input[type="password"]\') !== null');
        return {
          ok: false,
          reason: signIn
            ? `the app is asking to sign in, so the token was refused — "${projectName}" was never reachable`
            : `no project named "${projectName}" became clickable, and no workspace was open either`,
        };
      }
      if (!await waitFor(cdp, sessionId, TABS_PRESENT)) {
        return { ok: false, reason: `opening project "${projectName}" rendered no tab strip` };
      }
    }

    if (!await waitFor(cdp, sessionId, clickTab(tabLabel))) {
      const labels = await evaluate(
        cdp,
        sessionId,
        'Array.from(document.querySelectorAll(\'[role="tab"]\')).map((node) => node.getAttribute("aria-label")).join(", ")',
      );
      return { ok: false, reason: `no tab labelled "${tabLabel}"; the strip offers: ${labels || '(none)'}` };
    }

    // Every expected string, or none of them. A pane that half-rendered is a failure with a list
    // of what is missing rather than a retry loop that might eventually agree with itself.
    const until = Date.now() + WAIT_MS;
    let text = '';
    while (Date.now() < until) {
      try {
        text = await evaluate(cdp, sessionId, VISIBLE_TEXT);
      } catch {
        text = ''; // the pane is still mounting
      }
      if (expects.every((needle) => text.includes(needle))) {
        return { ok: true };
      }
      await delay(POLL_MS);
    }

    const missing = expects.filter((needle) => !text.includes(needle));
    return { ok: false, reason: `missing from "${tabLabel}": ${missing.map((needle) => JSON.stringify(needle)).join(', ')}` };
  } catch (error) {
    return { ok: false, reason: error.message };
  } finally {
    // Guarded, because the launch itself can be what failed: there is nothing to shut down then,
    // and `browser` is still null.
    if (browser) await closeBrowser(browser);
    browser = null;
  }
}

let outcome;
try {
  outcome = await main();
} catch (error) {
  // `main` catches the walk; this catches `main`. Shutting the browser down and removing its
  // profile both touch the filesystem, and either can throw on its own. The verdict line is a
  // contract, and a contract that holds only while nothing throws is not one.
  outcome = { ok: false, reason: error.message };
}

clearTimeout(watchdog);
report(outcome.ok, outcome.reason);
