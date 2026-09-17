#!/usr/bin/env node
// Opens the real app in a real browser, walks to the Universe tab the way a reader does, and reports
// whether the sky actually painted.
//
//   node scripts/universe-ui-probe.mjs <app-url> <token> <out.png>
//
// It prints exactly one line and exits — `canvas=<w>x<h> painted=<n>` — so a caller greps the result
// instead of reading a log, and `NO-CANVAS` (with every reason on stderr) when there is no sky to
// report. Nothing is hard-coded but the tab's own name: the url, the token and the output path all
// arrive as arguments.
//
// WHY A BROWSER. What this checks — that the tab is reachable, that the canvas took its box, that a
// frame with stars was really drawn — exists only after React and a canvas loop have run. A curl of
// `/api/universe/map` would answer none of it: the map is JSON, and the failure this probe exists to
// catch is a page whose JSON arrived and whose sky never painted.
//
// WHY IT READS PIXELS. The screenshot is the proof the caller keeps, and one taken before the first
// frame is a blank rectangle that looks exactly like a passing one — so the canvas is read back and
// the samples that stand out from their own neighbourhood are counted. More work than trusting the
// app, and the only version of this that a stopped loop cannot fool.
//
// Two neighbours carry the parts that are not the walk: `scripts/universe-browser.mjs` is the chrome
// (nothing here knows how a headless browser is started), and `scripts/universe-paint.mjs` is the
// metric (nothing here decides what counts as drawn). This file is the path between them.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { WAIT_MS, closeBrowser, connectBrowser, evaluate, launchBrowser, openTab, waitFor } from './universe-browser.mjs';
import { CANVAS, readPaint, waitForPaint } from './universe-paint.mjs';

/**
 * How long the whole probe may take before it answers rather than hanging. It sits UNDER the ceiling
 * a caller puts on this command — the plan runner kills one at 120 s — so a probe that would be
 * killed answers first instead, and a reason on stderr is worth more to the next reader than a
 * corpse. A pass takes five seconds and never reaches this.
 */
const WATCHDOG_MS = 115_000;
/**
 * How long to let the app settle before deciding that no workspace is open. The shell paints first
 * and the tab strip arrives a moment later, so asking on that first paint answers "no" for an app
 * that had a workspace all along.
 */
const STRIP_MS = 10_000;
/**
 * How long to wait for the sky's first drawn frame. Laying out 9,245 stars and their edges is real
 * work, so this is generous on purpose — and bounded this side of the watchdog, because "slow" and
 * "never" have to come back as different answers.
 */
const PAINT_MS = 20_000;

/** The answer when there is no sky: one word, in the voice of `universe-ws-probe.mjs`'s NO-FRAME. */
const NO_CANVAS = 'NO-CANVAS';

/**
 * The Universe tab's accessible name — the English label the strip carries (`tabs.universe` in
 * `src/modules/i18n/locales/en/common.json`) and the `aria-label` `Tabs` gives every tab so the
 * harness can select one by name.
 */
const TAB_LABEL = 'Universe';

/** The workspace strip exists only once a project is open — the app's own "we are somewhere" signal. */
const TABS_PRESENT = 'document.querySelectorAll(\'[role="tab"]\').length > 0';

/** The canvas has taken its box — a canvas in an unmounted or hidden pane is 0 by 0. */
const CANVAS_SIZED = `(() => {
  const canvas = document.querySelector(${JSON.stringify(CANVAS)});
  if (canvas === null) return false;
  const rect = canvas.getBoundingClientRect();
  return canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0;
})()`;

const [appUrl, token, outPath] = process.argv.slice(2);

if (!appUrl || !token || !outPath) {
  console.error('usage: node scripts/universe-ui-probe.mjs <app-url> <token> <out.png>');
  process.exit(2);
}

/** The browser, from the moment it exists until it is shut down.
 *
 * It lives here rather than inside `main` so the watchdog can reach it — an exit taken from inside a
 * `try` runs no `finally`, and a probe that answered early would leave a whole browser and its
 * profile directory behind, one per run.
 */
let browser = null;

/** The step the probe is on, in the caller's words.
 *
 * The per-step budgets below are generous on purpose, and together they outlast the watchdog — so a
 * page that stalls at several of them reaches the watchdog rather than any step's own reason, and
 * "nothing settled within 115000ms" alone would leave the next reader timing the walk by hand. This
 * is what turns that line into "…while waiting on the sky's first drawn frame".
 */
let stage = 'the browser starting';

/** Answers the one line and leaves. The last line is the contract, and it runs after the browser has
 *  been shut down, never instead of it. */
function report(line, reason) {
  if (reason) console.error(`universe-ui-probe: ${reason}`);
  console.log(line);
  process.exit(line === NO_CANVAS ? 1 : 0);
}

/** The answer when there is nothing to report: the one word, and why. */
function noSky(reason) {
  return { line: NO_CANVAS, reason };
}

/**
 * The whole probe is on a clock: a page that never answers must still produce its one line. This is
 * the one path that cannot unwind — nothing about it settled — so it shuts the browser down itself
 * before it answers.
 */
const watchdog = setTimeout(async () => {
  if (browser) await closeBrowser(browser);
  report(NO_CANVAS, `nothing settled within ${WATCHDOG_MS}ms — still waiting on ${stage}`);
}, WATCHDOG_MS);
watchdog.unref();

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

/**
 * Walks the app and returns the verdict — `{ line, reason? }`, never an exit. Leaving has to happen
 * where the browser is shut down, so a probe that fails and one that passes leave the box in exactly
 * the same state: nothing running, and nothing on disk but the screenshot it was asked for.
 */
async function main() {
  try {
    // Inside the try, not before it: a shell that cannot start at all is the same news as one that
    // starts and never answers, and both have to come back as a reason rather than as a rejection
    // the top level was never built to catch.
    const launched = await launchBrowser();
    browser = launched;

    stage = "the browser's own debugging socket";
    const cdp = await connectBrowser(launched.port);
    stage = 'the first page opening';
    const sessionId = await openTab(cdp, appUrl);

    // An app that is not answering leaves the browser on its own error page — a document that IS
    // complete, on an origin that will throw when `localStorage` is touched. So "did it load?" is
    // asked of the ORIGIN and not of `readyState`, or the next reader is sent chasing a credential
    // problem on an app that is simply down.
    const landed = `location.origin === ${JSON.stringify(new URL(appUrl).origin)} && document.readyState === "complete"`;
    stage = `${appUrl} finishing its first load`;
    if (!await waitFor(cdp, sessionId, landed)) {
      const shown = await evaluate(cdp, sessionId, 'location.href').catch(() => '(nothing)');
      return noSky(`${appUrl} never finished loading — the browser is on ${shown}`);
    }

    // The token goes in on the app's OWN origin, which is why the navigation came first: on a blank
    // page localStorage belongs to nobody, and the write would be discarded.
    await evaluate(cdp, sessionId, `localStorage.setItem('auth-token', ${JSON.stringify(token)})`);
    await cdp.send('Page.reload', {}, sessionId);
    stage = `${appUrl} finishing the reload`;
    if (!await waitFor(cdp, sessionId, 'document.readyState === "complete"')) {
      return noSky(`${appUrl} never finished reloading`);
    }
    stage = 'the app painting anything at all';
    if (!await waitFor(cdp, sessionId, 'document.body.innerText.trim().length > 0')) {
      return noSky('the app painted nothing at all after the token was written and the page reloaded');
    }

    // The strip is where the tab lives, so its absence is the first thing to answer — and a password
    // field inside it is the app asking to sign in, which almost always means the token was refused.
    // A much more useful thing to say than "no such tab", which would send the next reader looking
    // for a tab that exists and a credential that does not.
    stage = 'the workspace tab strip';
    if (!await waitFor(cdp, sessionId, TABS_PRESENT, STRIP_MS)) {
      const signIn = await evaluate(cdp, sessionId, 'document.querySelector(\'input[type="password"]\') !== null');
      return noSky(signIn
        ? `the app is asking to sign in, so the token was refused — no "${TAB_LABEL}" tab was ever reachable`
        : `no workspace tab strip appeared within ${STRIP_MS}ms, so there is no "${TAB_LABEL}" tab to open`);
    }

    stage = `the "${TAB_LABEL}" tab opening`;
    if (!await waitFor(cdp, sessionId, clickTab(TAB_LABEL))) {
      const labels = await evaluate(
        cdp,
        sessionId,
        'Array.from(document.querySelectorAll(\'[role="tab"]\')).map((node) => node.getAttribute("aria-label")).join(", ")',
      );
      return noSky(`no tab labelled "${TAB_LABEL}"; the strip offers: ${labels || '(none)'}`);
    }

    stage = 'the canvas taking its box';
    if (!await waitFor(cdp, sessionId, CANVAS_SIZED)) {
      return noSky(`opening "${TAB_LABEL}" produced no canvas with a size within ${WAIT_MS}ms`);
    }

    stage = "the sky's first drawn frame";
    const reading = await waitForPaint(cdp, sessionId, PAINT_MS);
    if (reading === null) {
      return noSky(`the canvas took its box but nothing was drawn on it within ${PAINT_MS}ms`);
    }

    // The capture is BRACKETED by two readings: the one above found structure, and the one below
    // asks again as soon as the PNG exists. So the number the caller greps describes the frame the
    // file holds, and a canvas that went blank between them is reported as the empty proof it would
    // be rather than as a pass — the failure this whole probe guards against is a screenshot of
    // nothing, and the sky repaints on its own every frame, so "it was painted a moment ago" is not
    // the same claim as "it was painted when the shutter opened".
    stage = 'the screenshot';
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const captured = await readPaint(cdp, sessionId);
    if (captured === null || captured.painted === 0) {
      return noSky('the canvas went blank between the frame that was read and the screenshot');
    }
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, Buffer.from(shot.data, 'base64'));

    return { line: `canvas=${captured.w}x${captured.h} painted=${captured.painted}` };
  } catch (error) {
    return noSky(error.message);
  } finally {
    // Guarded, because the launch itself can be what failed: there is nothing to shut down then, and
    // `browser` is still null.
    if (browser) await closeBrowser(browser);
    browser = null;
  }
}

let outcome;
try {
  outcome = await main();
} catch (error) {
  // `main` catches the walk; this catches `main`. Shutting the browser down and removing its profile
  // both touch the filesystem, and either can throw on its own. The verdict line is a contract, and
  // a contract that holds only while nothing throws is not one.
  outcome = noSky(error.message);
}

clearTimeout(watchdog);
report(outcome.line, outcome.reason);
