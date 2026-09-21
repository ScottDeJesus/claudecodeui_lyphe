#!/usr/bin/env node
// Walks the application switcher in a real browser: the FAB, the drawer, two panes, the divider, a drag
// of each, the dock snap, and the wordmark at 320px. It prints one `KEY=value` line per reading and then
// exactly one verdict line — `PROBE OK` or `PROBE FAILED` — so a caller greps the result instead of
// reading a log; everything that explains a failure goes to stderr.
//
//   node scripts/apps-ui-probe.mjs <app-url> <token> <fab-label> <row-a> <row-b>  |  --selftest <app-url> <token>
//
// `--selftest` runs the plumbing alone — launch, seed the token, load the app, assert the wordmark
// renders — printing `BOOT=1` and the verdict, so the phase that WROTE this driver also RUNS it, rather
// than leaving a 450-line CDP driver's first execution two waves away in a gate where a broken browser
// and a broken switcher arrive as the same news. Two things here are contracts. THE WINDOW IS SET to
// 1280x900 before any reading: below 768px the desktop header is `display: none`, the FAB defaults to
// floating, and every dock reading would pass by there being no dock on the page. And every drag is a
// REAL press, path and release over CDP: `element.click()` carries `detail: 0`, so it takes the keyboard
// path and never touches the drag.
//
// chrome-headless-shell is playwright's own download, already on this box; CHROME_HEADLESS_SHELL points elsewhere.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import WebSocket from 'ws';

const SHELL = process.env.CHROME_HEADLESS_SHELL || path.join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');
/** The window every reading is taken in, and the narrow one step 10 measures the wordmark at. */
const DESKTOP = { width: 1280, height: 900 };
const NARROW = { width: 320, height: 900 };
const WAIT_MS = 30_000;      // one wait: a port, a paint, an element
const SETTLE_MS = 10_000;    // a state change's grace before it is absent rather than late
const WATCHDOG_MS = 420_000; // the whole probe, before it answers rather than hangs
const POLL_MS = 200;
const STOP_GRACE_MS = 2_000; // how long a killed browser gets to actually be gone
/** Air around the kit's own numbers: the 64px snap checked to 8, a drag delta to 12. */
const SNAP_TOLERANCE_PX = 8;
const MOVE_TOLERANCE_PX = 12;
/** Where the divider is dragged to, as a share of the pane row, and how far off it may land. */
const TARGET_RATIO = 0.25;
const RATIO_TOLERANCE = 0.03;

const argv = process.argv.slice(2);
const selftest = argv[0] === '--selftest';
// The two rows the split is built from, by the names they carry in the registry — a file the
// operator edits by hand, so they arrive as arguments. The seed ships ONE row; a split needs two.
const [appUrl, token, fabLabel, rowA, rowB] = selftest ? argv.slice(1) : argv;
if (!appUrl || !token || (!selftest && (!fabLabel || !rowA || !rowB))) {
  console.error('usage: node scripts/apps-ui-probe.mjs <app-url> <token> <fab-label> <row-a> <row-b>');
  console.error('       node scripts/apps-ui-probe.mjs --selftest <app-url> <token>');
  process.exit(2);
}

// The browser, from the moment it exists until it is shut down. It lives outside `main` so the watchdog
// can reach it: an exit taken from inside a `try` runs no `finally`, so a probe that answered the moment
// it had a verdict would leave a browser and its profile behind on every run.
let browser = null;

/** One `KEY=value` reading. The contract's other half is the single verdict line at the end. */
function print(key, value) {
  console.log(`${key}=${value}`);
}

/** A step that could not be completed: its own line prints as a failure and the walk stops there. */
function fail(line, reason) {
  console.log(line);
  return { ok: false, reason };
}

/** Answers and leaves. This runs after the browser is down, never instead of shutting it down. */
function report(ok, reason) {
  if (reason) console.error(`apps-ui-probe: ${reason}`);
  console.log(ok ? 'PROBE OK' : 'PROBE FAILED');
  process.exit(ok ? 0 : 1);
}

// The whole probe is on a clock: a page that never answers must still produce its one line. This is the
// one path that cannot unwind — nothing settled — so it shuts the browser down itself.
const watchdog = setTimeout(async () => {
  if (browser) await shutdown(browser);
  report(false, `nothing settled within ${WATCHDOG_MS}ms`);
}, WATCHDOG_MS);
watchdog.unref();
/** A DevTools client over a plain websocket: one id per message, a promise per id, events dropped.
 *  `sessionId` turns a browser-level socket into one that addresses a single tab. */
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
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

/** Starts the shell with its debugging port picked by the browser and read back out of
 *  `DevToolsActivePort`: choosing one here would be a race against everything else on the box. */
async function launchBrowser() {
  const dir = await mkdtemp(path.join(tmpdir(), 'apps-ui-probe-'));
  const child = spawn(SHELL, [
    '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    `--window-size=${DESKTOP.width},${DESKTOP.height}`, 'about:blank',
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  // A missing or non-executable binary fails by EMITTING, not throwing; without this the loop below would
  // spend its whole window waiting for a port from a process that was never born.
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
  await shutdown({ child, dir });
  throw new Error(spawnError
    ? `could not start ${SHELL}: ${spawnError.message}`
    : `${SHELL} reported no debugging port within ${WAIT_MS}ms`);
}

/** Kills the browser, every child it forked, and the profile directory it wrote: a probe leaves nothing
 *  running and nothing on disk. */
async function shutdown({ child, dir }) {
  if (child.exitCode === null && child.signalCode === null) {
    const gone = once(child, 'exit').catch(() => {});
    try {
      // The negative pid addresses the process GROUP, which `detached` made this child the leader of;
      // killing the leader alone orphans children that then outlive the probe.
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
    // A signal is DELIVERED, not applied: returning the instant one is sent leaves "is one still
    // running?" to a coin toss. Bounded, so a process the kernel cannot kill cannot hold the probe.
    await Promise.race([gone, delay(STOP_GRACE_MS)]);
  }
  await rm(dir, { recursive: true, force: true });
}

/** Runs one expression in the page and returns its value. `description` carries a thrown error's own
 *  message; the bare `text` on a rejection is just "Uncaught", which tells the next reader nothing. */
async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  const details = result.exceptionDetails;
  if (details) throw new Error(details.exception?.description ?? details.text ?? 'the page threw');
  return result.result.value;
}

/** Polls a question until it is truthy — a page expression, or a node-side check such as the distance
 *  between two boxes. A throw is an answer, not a failure: mid-navigation there is nothing to ask. */
async function waitFor(cdp, sessionId, question, timeoutMs = WAIT_MS) {
  const ask = typeof question === 'function' ? question : () => evaluate(cdp, sessionId, question);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    // A throw is an answer: mid-navigation the document being asked belongs to the page that is leaving.
    try { if (await ask()) return true; } catch { /* the next poll asks the document that replaced it */ }
    await delay(POLL_MS);
  }
  return false;
}

/** The viewport is pinned rather than inherited: the dock readings are meaningless below 768px. */
const setViewport = (cdp, sessionId, size) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false }, sessionId);

/** One trusted mouse message. Every press and drag below is built on this and nothing else. */
const mouse = (cdp, sessionId, type, point, buttons) => cdp.send('Input.dispatchMouseEvent',
  { type, x: point.x, y: point.y, button: 'left', buttons, clickCount: 1 }, sessionId);

/** A press moved in steps and released: a drag the pointer-capture code can actually follow. */
async function drag(cdp, sessionId, from, to, steps = 10) {
  await mouse(cdp, sessionId, 'mousePressed', from, 1);
  for (let step = 1; step <= steps; step += 1) {
    await mouse(cdp, sessionId, 'mouseMoved', { x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps }, 1);
    await delay(16);
  }
  await mouse(cdp, sessionId, 'mouseReleased', to, 0);
}

/** A press and a release that never moved — the pointer path's own press, so `moved` is false. Aimed at
 *  the box's CENTRE: the FAB is a pill, and the corner of a rounded box is outside its hit area, so a
 *  press on `box.x`/`box.y` is delivered to whatever is underneath and `onPointerDown` never runs. */
async function clickAt(cdp, sessionId, point) {
  await mouse(cdp, sessionId, 'mousePressed', point, 1);
  await mouse(cdp, sessionId, 'mouseReleased', point, 0);
}

// ------------------------------------------------------------------------------- the page's shape
/** The FAB, by the one attribute the kit promises from its `label` prop. `Boolean(...)` around it: a
 *  `.find()` that matches nothing answers `undefined`, and `undefined !== null` is TRUE. */
const fabNode = (label) =>
  `Array.from(document.querySelectorAll('button')).find((node) => node.getAttribute('aria-label') === ${JSON.stringify(label)})`;

/**
 * The dock slot, found structurally: the FIRST child of the app's logo row, and a sibling of whichever
 * branch holds the wordmark — `{leading && !isCompact && …}`, never inside `LogoBlock`, whose two anchor
 * call sites would make a slot placed there a button inside a link.
 */
const DOCK_NODE = `(() => {
  const wordmark = Array.from(document.querySelectorAll('h1')).find((n) => n.getClientRects().length > 0);
  if (!wordmark) return null;
  let row = wordmark.parentElement;
  while (row && !/(^|\\s)justify-between(\\s|$)/.test(String(row.className || ''))) row = row.parentElement;
  const slot = row && row.firstElementChild;
  return slot && !slot.contains(wordmark) ? slot : null;
})()`;

const DIALOG = `document.querySelector('[role="dialog"]')`;
const SEPARATOR = `document.querySelector('[role="separator"]')`;
/** A pane, told apart from every other frame in the app by the attribute this feature fixes: a frame
 *  mounted without `allow` cannot be granted geolocation, and the weather tile asks for it. */
const PANES = `document.querySelectorAll('iframe[allow*="geolocation"]')`;

/** The app's own "we are somewhere": the sidebar has painted and the wordmark is on screen. */
const BOOTED = `Array.from(document.querySelectorAll('h1')).some((n) => n.getClientRects().length > 0 && n.textContent.trim().length > 0)`;

/** One element's box as plain numbers, or null when it is off the page or draws nothing. */
const boxOf = (node) => `(() => { const t = ${node}; if (!t) return null;
  const r = t.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return null;
  return { x: r.left, y: r.top, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`;

/** How far the FAB's centre is from the dock's centre, or null when there is no dock to measure. */
async function fabDockGap(cdp, sessionId, label) {
  const fab = await evaluate(cdp, sessionId, boxOf(fabNode(label)));
  const dock = await evaluate(cdp, sessionId, boxOf(DOCK_NODE));
  if (!fab || !dock) return null;
  return Math.hypot(fab.cx - dock.cx, fab.cy - dock.cy);
}

/** Clicks the drawer's row for `name`: a row reads "name, host, maybe on screen", so the match is a
 *  prefix and the tightest element carrying it wins. */
const clickRow = (name) => `(() => { const dialog = ${DIALOG}; if (!dialog) return false;
  const rows = Array.from(dialog.querySelectorAll('button, a, [role="button"]'))
    .filter((n) => n.getClientRects().length > 0 && n.textContent.trim().startsWith(${JSON.stringify(name)}));
  if (rows.length === 0) return false;
  rows.sort((a, b) => a.textContent.length - b.textContent.length); rows[0].click(); return true; })()`;

/** The left pane's share of the pane row, as the browser has laid it out. */
const RATIO_READING = `(() => { const divider = ${SEPARATOR}; const row = divider && divider.parentElement;
  if (!row) return null; const total = row.getBoundingClientRect().width;
  return total === 0 ? null : row.children[0].getBoundingClientRect().width / total; })()`;

/** The wordmark's overflow test: `truncate` is `overflow: hidden`, so scrollWidth is the whole text. */
const WORDMARK = `(() => { const node = Array.from(document.querySelectorAll('h1')).find((n) => n.getClientRects().length > 0);
  if (!node || node.textContent.trim().length === 0) return null;
  return { text: node.textContent.trim(), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }; })()`;

/** The drawer, up. Opened only when it is down: pressing the FAB while it is up closes it, so a blind
 *  press would work every other run and fail the rest. */
async function ensureDrawer(cdp, sessionId, label) {
  if (await evaluate(cdp, sessionId, `(${DIALOG}) !== null`)) return true;
  const fab = await evaluate(cdp, sessionId, boxOf(fabNode(label)));
  if (!fab) return false;
  await clickAt(cdp, sessionId, { x: fab.cx, y: fab.cy });
  return waitFor(cdp, sessionId, `(${DIALOG}) !== null`);
}

/** The drawer, down. It is a portalled Dialog whose `fixed inset-0` backdrop outranks the workspace
 *  shell the FAB and the divider live in, so while it is up a press aimed at either one lands on the
 *  backdrop — and steps 5 to 9 press both. Escape is a real key, and the dismissal the Dialog's own
 *  window-capture listener answers. */
async function closeDrawer(cdp, sessionId) {
  if (!await evaluate(cdp, sessionId, `(${DIALOG}) !== null`)) return true;
  for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
  return waitFor(cdp, sessionId, `(${DIALOG}) === null`, SETTLE_MS);
}
// --------------------------------------------------------------------------------- the ten-step walk

/** The scenario, returning `{ ok, reason }` or throwing. Leaving the box clean is `main`'s job. */
async function scenario(cdp, sessionId) {
  const drawerUp = `(${DIALOG}) !== null`;
  // 1 — the FAB.
  if (!await waitFor(cdp, sessionId, `Boolean(${fabNode(fabLabel)})`)) return fail('FAB=0', `no button whose aria-label is ${JSON.stringify(fabLabel)}`);
  print('FAB', 1);
  // 2 — the drawer, opened how a reader opens it: a real press and release. `element.click()` carries
  //     `detail: 0` and takes the keyboard path, so this is what proves the POINTER path opens it.
  const fab = await evaluate(cdp, sessionId, boxOf(fabNode(fabLabel)));
  if (!fab) return fail('DRAWER=0', 'the FAB has no box to press');
  await clickAt(cdp, sessionId, { x: fab.cx, y: fab.cy });
  if (!await waitFor(cdp, sessionId, drawerUp)) return fail('DRAWER=0', 'a real press on the FAB opened no drawer');
  const rows = await evaluate(cdp, sessionId, `(${DIALOG}).querySelectorAll('[aria-haspopup="menu"]').length`);
  print('DRAWER', 1);
  print('ROWS', rows);
  if (rows < 2) return fail(`ROWS=${rows}`, 'the drawer lists fewer than two applications; the split needs two');
  // 3 — one application on screen.
  if (!await waitFor(cdp, sessionId, clickRow(rowA))) return fail('PANES=0', `the drawer has no row reading ${JSON.stringify(rowA)}`);
  if (!await waitFor(cdp, sessionId, `${PANES}.length >= 1`, SETTLE_MS)) return fail('PANES=0', `clicking ${JSON.stringify(rowA)} framed no pane`);
  const pane = await evaluate(cdp, sessionId, `({ src: ${PANES}[0].getAttribute('src') || '', allow: ${PANES}[0].getAttribute('allow') || '' })`);
  print('PANES', 1);
  print('PANE0SRC', pane.src);
  print('PANE0ALLOW', pane.allow);
  // 4 — the second pane, split off the first. The Dual screen switch is found by its ROLE: the label is
  //     a translation.
  if (!await ensureDrawer(cdp, sessionId, fabLabel)) return fail('PANES=1', 'the drawer could not be reopened for the second pane');
  await evaluate(cdp, sessionId, `(() => { const toggle = ${DIALOG}.querySelector('[role="switch"]');
    if (toggle && toggle.getAttribute('aria-checked') !== 'true') toggle.click(); return true; })()`);
  if (!await waitFor(cdp, sessionId, clickRow(rowB))) return fail('PANES=1', `the drawer has no row reading ${JSON.stringify(rowB)}`);
  if (!await waitFor(cdp, sessionId, `${PANES}.length >= 2`, SETTLE_MS)) return fail('PANES=1', `dual screen is on and ${JSON.stringify(rowB)} framed no second pane`);
  const split = await evaluate(cdp, sessionId, `(${SEPARATOR}) !== null`);
  print('PANES', 2);
  print('SPLIT', split ? 1 : 0);
  if (!split) return { ok: false, reason: 'two panes are open and no separator stands between them' };
  // 5 — the divider, dragged by a real pointer to a quarter of the row. The sheet is asserted down
  //     first: a press that lands on its backdrop reads as a divider that never moved.
  if (!await closeDrawer(cdp, sessionId)) return fail('RATIO=0', 'the drawer would not dismiss, so the divider could not be reached');
  const divider = await evaluate(cdp, sessionId, boxOf(SEPARATOR));
  const row = await evaluate(cdp, sessionId, boxOf(`${SEPARATOR}.parentElement`));
  if (!divider || !row) return fail('RATIO=0', 'the pane row has no measurable box');
  await drag(cdp, sessionId, { x: divider.cx, y: divider.cy }, { x: row.x + row.width * TARGET_RATIO, y: divider.cy });
  const ratio = await evaluate(cdp, sessionId, RATIO_READING);
  const landed = Number.isFinite(ratio) ? ratio : null;
  print('RATIO', landed === null ? 0 : landed.toFixed(2));
  if (landed === null || Math.abs(landed - TARGET_RATIO) > RATIO_TOLERANCE) return { ok: false, reason: `the divider landed at ${landed} of the row rather than ${TARGET_RATIO}` };
  // 6 — the FAB against the dock with two panes up: the reader's way out, read in the state it must work in.
  let gap = null;
  const seated = await waitFor(cdp, sessionId, async () => {
    gap = await fabDockGap(cdp, sessionId, fabLabel);
    return gap !== null && gap <= SNAP_TOLERANCE_PX;
  }, SETTLE_MS);
  print('DOCKED', seated ? 1 : 0);
  if (!seated) return { ok: false, reason: gap === null ? 'no dock slot was found in the sidebar header, or the one found draws nothing' : `the FAB sits ${Math.round(gap)}px from the dock's centre` };
  // 7 — a drag of the FAB, and the drawer's state across it: a drag dispatches a click at its end with a
  //     non-zero `detail`, and a naive `onClick` would open the drawer every time the FAB moves.
  const before = await evaluate(cdp, sessionId, boxOf(fabNode(fabLabel)));
  const drawerBefore = await evaluate(cdp, sessionId, drawerUp);
  await drag(cdp, sessionId, { x: before.cx, y: before.cy }, { x: before.cx + 180, y: before.cy + 90 });
  const after = await evaluate(cdp, sessionId, boxOf(fabNode(fabLabel)));
  const drawerAfter = await evaluate(cdp, sessionId, drawerUp);
  const drift = after ? Math.hypot(after.cx - before.cx - 180, after.cy - before.cy - 90) : Infinity;
  print('FABMOVED', after && drift <= MOVE_TOLERANCE_PX && drawerAfter === drawerBefore ? 1 : 0);
  if (!after) return fail('FABMOVED=0', 'the FAB lost its box in mid-drag');
  if (drawerAfter !== drawerBefore) return { ok: false, reason: 'the drag opened or closed the drawer: the click that ends a drag was not swallowed' };
  if (drift > MOVE_TOLERANCE_PX) return { ok: false, reason: `the FAB's centre drifted ${Math.round(drift)}px from the 180,90 it was dragged by` };
  // 8 — dropped back into the dock, from a real drag, and read where it landed.
  const target = await evaluate(cdp, sessionId, boxOf(DOCK_NODE));
  if (!target) return fail('FABSNAPPED=0', 'the dock slot has no box to be dropped into');
  await drag(cdp, sessionId, { x: after.cx, y: after.cy }, { x: target.cx, y: target.cy });
  // The class as well as the geometry: a FAB near the dock but still floating is not docked.
  const snapped = await waitFor(cdp, sessionId, async () => {
    gap = await fabDockGap(cdp, sessionId, fabLabel);
    const docked = await evaluate(cdp, sessionId, `(${fabNode(fabLabel)}).className.includes('vv-fab--docked')`);
    return gap !== null && gap <= SNAP_TOLERANCE_PX && docked;
  }, SETTLE_MS);
  print('FABSNAPPED', snapped ? 1 : 0);
  if (!snapped) return { ok: false, reason: gap !== null && gap <= SNAP_TOLERANCE_PX ? 'the FAB returned to the dock but still renders at the floating size' : `the FAB did not return to the dock: ${gap === null ? 'there is nowhere measurable to return to' : `it sits ${Math.round(gap)}px from the dock's centre`}` };
  // 9 — the position survives a reload; the failure this catches is a stored `docked` read before the
  //     dock has a rect, which paints the FAB in the corner and leaves it there.
  const leftAt = await evaluate(cdp, sessionId, boxOf(fabNode(fabLabel)));
  await cdp.send('Page.reload', {}, sessionId);
  if (!await waitFor(cdp, sessionId, 'document.readyState === "complete"')) return fail('FABPERSIST=0', `${appUrl} never finished reloading`);
  let cameBack = null;
  const persisted = await waitFor(cdp, sessionId, async () => {
    cameBack = await evaluate(cdp, sessionId, boxOf(fabNode(fabLabel)));
    return cameBack !== null && Math.hypot(cameBack.cx - leftAt.cx, cameBack.cy - leftAt.cy) <= SNAP_TOLERANCE_PX;
  }, WAIT_MS);
  print('FABPERSIST', persisted ? 1 : 0);
  if (!persisted) return { ok: false, reason: cameBack === null ? 'the FAB was gone after the reload' : `the FAB came back ${Math.round(Math.hypot(cameBack.cx - leftAt.cx, cameBack.cy - leftAt.cy))}px from where it was left` };
  // 10 — the wordmark at 320px: docked, the FAB is 36px beside a 26px wordmark in a 328px rail, and that
  //      size was ruled on the wordmark still rendering whole here.
  await setViewport(cdp, sessionId, NARROW);
  let wordmark = null;
  const measured = await waitFor(cdp, sessionId, async () => {
    wordmark = await evaluate(cdp, sessionId, WORDMARK);
    return wordmark !== null;
  }, SETTLE_MS);
  if (!measured) return fail('WORDMARK=0', 'no wordmark rendered at 320px');
  const whole = wordmark.scrollWidth <= wordmark.clientWidth + 1;
  print('WORDMARK', whole ? 1 : 0);
  if (!whole) return { ok: false, reason: `"${wordmark.text}" is truncated at 320px: ${wordmark.scrollWidth}px of text in ${wordmark.clientWidth}px` };
  return { ok: true };
}

/**
 * Launches, seeds the token, loads the app and — unless this is the selftest — walks the scenario. It
 * returns `{ ok, reason }`, never an exit: leaving has to happen where the browser is shut down.
 */
async function main() {
  try {
    const launched = await launchBrowser();
    browser = launched;
    const socket = new WebSocket((await (await fetch(`http://127.0.0.1:${launched.port}/json/version`)).json()).webSocketDebuggerUrl);
    await once(socket, 'open');
    const cdp = new Cdp(socket);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    // Before the first reading, not after: the dock readings below are meaningless under 768px.
    await setViewport(cdp, sessionId, DESKTOP);
    await cdp.send('Page.navigate', { url: appUrl }, sessionId);
    if (!await waitFor(cdp, sessionId, 'document.readyState === "complete"')) return { ok: false, reason: `${appUrl} never finished loading` };
    // The token goes in on the app's OWN origin, which is why the navigate comes first: on a blank page
    // localStorage belongs to nobody and the write would be discarded.
    await evaluate(cdp, sessionId, `localStorage.setItem('auth-token', ${JSON.stringify(token)})`);
    await cdp.send('Page.reload', {}, sessionId);
    if (!await waitFor(cdp, sessionId, 'document.readyState === "complete"')) return { ok: false, reason: `${appUrl} never finished reloading` };
    if (!await waitFor(cdp, sessionId, BOOTED)) {
      // A password field is the app asking to sign in, which almost always means the token was refused —
      // a far more useful thing to say than "the wordmark never painted".
      const signIn = await evaluate(cdp, sessionId, `document.querySelector('input[type="password"]') !== null`);
      return { ok: false, reason: signIn ? 'the app is asking to sign in, so the token was refused' : 'the app never painted its wordmark' };
    }
    print('BOOT', 1);
    return selftest ? { ok: true } : await scenario(cdp, sessionId);
  } catch (error) {
    return { ok: false, reason: error.message };
  } finally {
    // Guarded, because the launch itself can be what failed: there is nothing to shut down then.
    if (browser) await shutdown(browser);
    browser = null;
  }
}
// `main` catches the walk; this catches `main`. Shutting the browser down and removing its profile both
// touch the filesystem and either can throw on its own — and the verdict line is a contract.
const outcome = await main().catch((error) => ({ ok: false, reason: error.message }));

clearTimeout(watchdog);
report(outcome.ok, outcome.reason);
