#!/usr/bin/env node
// Walks the settings dialog's "Authenticate for designs" row in a real browser: Settings → Agents →
// Claude → Account, the row that must sit directly under Re-authenticate, the modal's title, and the two
// facts that decide whether the feature works at all — that the embedded terminal answers with Claude
// Design's sign-in URL rather than an unknown-command error, and that the command is not refused for
// running inside a Claude Code session. It then walks the sign-in row ABOVE it the same way, because the
// two rows are the pair whose separation is the feature: each must run its own authorization, and neither
// may answer with the other's. It prints one `KEY=value` line per reading and then exactly one verdict
// line — `PROBE OK` or `PROBE FAILED` — so a caller greps the result instead of reading a log;
// everything that explains a failure goes to stderr.
//
//   node scripts/design-login-probe.mjs <app-url>
//
// The token is minted the way this house's probes mint one — `scripts/universe-token.mjs`, which signs
// the app's own payload with the secret the live server verifies with — so the only argument is the
// client to walk. The walk NEVER completes the sign-in: the authorization prompt is opened exactly as a
// person meets it, the modal is closed, and the operator finishes the grant himself.
//
// Three things here are contracts, each measured rather than assumed.
//
// The terminal's contents come off the `/shell` websocket, not off the screen: xterm renders through
// WebGL (canvas as a fallback), so the glyphs the user reads are never in the DOM. The frames this
// server sends ARE what the terminal draws, and `.xterm` being mounted is the separate fact that a
// terminal is there to draw them into.
//
// What those frames CANNOT say is whether the press being proved started anything. The server keeps a
// plain shell's pty alive for 30 minutes after its socket closes and replays its buffer to the next
// client that asks for it (`ptySessionsMap`, PTY_SESSION_TIMEOUT), so a reading over the whole frame log
// passes on a parked session's replay while the command the button names never runs. Every reading below
// is therefore taken from the frames that arrive after the press (`window.__shellMark`), and two further
// things are read that a replay cannot fake: the server's own `[Reconnected to existing session]` banner
// must be absent, and `ps` must show one more login process than before the press — the only reading
// here taken outside the browser.
//
// The theme is flipped by the `dark` class on <html> — the whole of how this app applies a theme
// (`src/shared/context/ThemeContext.tsx` adds and removes exactly that class) — and never by pressing
// the real toggle, which would persist the flip into the operator's stored preference in auth.db. A
// probe has no business writing that, and the light screenshots prove the same paint either way.
//
// Console errors are read from the browser itself (`Runtime` and `Log` domains) rather than from a
// wrapper installed in the page, so a 404 or a security error counts the same as a thrown exception.
//
// chrome-headless-shell is playwright's own download, already on this box; CHROME_HEADLESS_SHELL points elsewhere.
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import WebSocket from 'ws';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(SCRIPT_DIR);
const SHELL = process.env.CHROME_HEADLESS_SHELL || path.join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');
/** The two windows the account pane is photographed in: the desktop dialog, and a phone's own 390x844. */
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const WAIT_MS = 30_000;      // one wait: a port, a paint, an element
const SETTLE_MS = 10_000;    // a state change's grace before it is absent rather than late
const TERMINAL_WAIT_MS = 90_000; // the CLI boots and runs its SessionStart hooks before it answers
const WATCHDOG_MS = 420_000; // the whole probe, before it answers rather than hangs
const POLL_MS = 200;
const STOP_GRACE_MS = 2_000; // how long a killed browser gets to actually be gone
/** Where the six screenshots land. Stable rather than timestamped: one run's files, overwritten by the next. */
const SHOT_DIR = process.env.DESIGN_LOGIN_PROBE_SHOTS || path.join(tmpdir(), 'design-login-probe');

const [appUrl] = process.argv.slice(2);
if (!appUrl) {
  console.error('usage: node scripts/design-login-probe.mjs <app-url>');
  console.error('       node scripts/design-login-probe.mjs http://127.0.0.1:5183');
  process.exit(2);
}

// The copy the row must render. English, and read for real rather than assumed: this app falls back to
// `en` for any key a locale lacks, and these three are `en`-only, so every reader sees them.
const TITLE = 'Authenticate for designs';
const DESCRIPTION = 'Authorize Claude Design';
const BUTTON = 'Authenticate';
/** Either title the sign-in row above it carries, depending on whether this account is already signed in. */
const LOGIN_TITLES = ['Re-authenticate', 'Login'];
const MODAL_TITLE = 'Claude Design Login';
/** The other half of the walk: the sign-in row's modal, whose title is the provider's own unchanged one. */
const ACCOUNT_MODAL_TITLE = 'Claude CLI Login';

// The three pieces of server text each flow's terminal is read for. The two panels are a second panel's
// heading — `/design-login` draws "Design login", `/login` draws a "Select login method" menu — so a
// read that finds the wrong one has caught the two rows answering with each other's authorization.
const DESIGN_PANEL_MARKER = 'Design login';
const ACCOUNT_PANEL_MARKER = 'Select login method';
const REATTACH_BANNER = '[Reconnected to existing session]';

/** The two commands the settings rows run, exactly as `ps` reports them for the pty that is running one. */
const LOGIN_COMMAND = {
  account: 'claude --dangerously-skip-permissions /login',
  design: 'claude --dangerously-skip-permissions /design-login',
};

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
  if (reason) console.error(`design-login-probe: ${reason}`);
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

/** The token, minted by the script that knows how: it reads the one user and the app's own JWT secret
 *  out of the live auth database, the same pair the server's middleware signs and verifies with. */
function mintToken() {
  const token = execFileSync(process.execPath, [path.join(SCRIPT_DIR, 'universe-token.mjs')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  if (!token) throw new Error('scripts/universe-token.mjs printed no token');
  return token;
}

/** A DevTools client over a plain websocket: one id per message, a promise per id, and the events this
 *  probe subscribes to. `sessionId` turns a browser-level socket into one that addresses a single tab. */
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return; // a frame that is not JSON is not a reply to anything
      }
      if (message.id === undefined) {
        // An event. Only the domains this probe enables are subscribed to; the rest are dropped.
        for (const handler of this.listeners.get(message.method) ?? []) handler(message.params);
        return;
      }
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

  on(method, handler) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), handler]);
  }
}

/** Starts the shell with its debugging port picked by the browser and read back out of
 *  `DevToolsActivePort`: choosing one here would be a race against everything else on the box. */
async function launchBrowser() {
  const dir = await mkdtemp(path.join(tmpdir(), 'design-login-probe-'));
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
 *  running and nothing on disk. That directory is one this process named itself, moments ago, from a
 *  fixed prefix — and the removal is guarded on that prefix so a shorter path can never be the target. */
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
  if (path.basename(dir).startsWith('design-login-probe-')) await rm(dir, { recursive: true, force: true });
}

/** Runs one expression in the page and returns its value. `description` carries a thrown error's own
 *  message; the bare `text` on a rejection is just "Uncaught", which tells the next reader nothing. */
async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  const details = result.exceptionDetails;
  if (details) throw new Error(details.exception?.description ?? details.text ?? 'the page threw');
  return result.result.value;
}

/** Polls a question until it is truthy — a page expression, or a node-side check such as whether the
 *  terminal has answered yet. A throw is an answer, not a failure: mid-navigation there is nothing to ask. */
async function waitFor(cdp, sessionId, question, timeoutMs = WAIT_MS) {
  const ask = typeof question === 'function' ? question : () => evaluate(cdp, sessionId, question);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { if (await ask()) return true; } catch { /* the next poll asks the document that replaced it */ }
    await delay(POLL_MS);
  }
  return false;
}

/** The viewport is pinned rather than inherited: the two photographed layouts are a desktop dialog and a
 *  phone, and neither is this browser's default window. */
const setViewport = (cdp, sessionId, size) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false }, sessionId);

/** One trusted mouse message. The press on the row, on the Settings button and on the close button are
 *  all built on this and nothing else: `element.click()` carries `detail: 0` and takes the keyboard path,
 *  so it would prove nothing about the pointer a person actually uses. */
const mouse = (cdp, sessionId, type, point, buttons) => cdp.send('Input.dispatchMouseEvent',
  { type, x: point.x, y: point.y, button: 'left', buttons, clickCount: 1 }, sessionId);

async function clickAt(cdp, sessionId, point) {
  await mouse(cdp, sessionId, 'mousePressed', point, 1);
  await mouse(cdp, sessionId, 'mouseReleased', point, 0);
}

// ------------------------------------------------------------------------------- the page's shape
/** A box as plain numbers, or null when the node is off the page or draws nothing. */
const boxOf = (node) => `(() => { const node = ${node}; if (!node) return null;
  const rect = node.getBoundingClientRect(); if (rect.width === 0 && rect.height === 0) return null;
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 }; })()`;

/** The sidebar's Settings row. Found by the icon it wears, not by its label: the label is a translation,
 *  and this probe must not care which language the operator reads. */
const SETTINGS_BUTTON = `Array.from(document.querySelectorAll('button')).find((node) => node.getClientRects().length > 0 && node.querySelector('svg.lucide-settings')) || null`;

/** The selector-based helpers every reading below is built from, as one string so the shapes cannot
 *  drift apart: the smallest visible div whose OWN text is exactly `label` (the row's title, not the
 *  block that contains it), the bordered block a row IS, and its box. Each expression that uses these
 *  declares its own locals — the one thing that cannot be shared through a string is a `const` name. */
const ROW_HELPERS = `
  const smallest = (label) => {
    const hits = Array.from(document.querySelectorAll('div'))
      .filter((node) => node.getClientRects().length > 0 && node.textContent.trim() === label);
    hits.sort((a, b) => a.textContent.length - b.textContent.length);
    return hits[0] || null;
  };
  const blockOf = (node) => { let current = node; while (current && !current.classList.contains('border-t')) current = current.parentElement; return current; };
  const rectOf = (node) => { const rect = node.getBoundingClientRect(); return { top: Math.round(rect.top), bottom: Math.round(rect.bottom) }; };
  const centreOf = (node) => { const rect = node.getBoundingClientRect(); return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 }; };
  const designRowBlock = () => blockOf(smallest(${JSON.stringify(TITLE)}));
  const loginRowBlock = () => { const label = ${JSON.stringify(LOGIN_TITLES)}.find((title) => smallest(title)); return label ? blockOf(smallest(label)) : null; };
`;

/**
 * The account pane's two rows, read structurally rather than by eye: from each row's title text, walk up
 * to the bordered block that IS the row, and then compare the two blocks. "Directly under" is three
 * separate claims — the design block is the sign-in block's next element sibling, both live in the same
 * card, and the design block's top is at or below the sign-in block's bottom — and all three are returned
 * so a failure can name which one broke rather than only that one did.
 */
const ACCOUNT_ROWS = `(() => {${ROW_HELPERS}
  const loginLabel = ${JSON.stringify(LOGIN_TITLES)}.find((label) => smallest(label)) || null;
  const loginTitle = loginLabel ? smallest(loginLabel) : null;
  const designTitle = smallest(${JSON.stringify(TITLE)});
  if (!loginTitle || !designTitle) return { login: Boolean(loginTitle), design: Boolean(designTitle), loginLabel };
  const signInBlock = blockOf(loginTitle);
  const designBlock = blockOf(designTitle);
  const button = designBlock ? designBlock.querySelector('button') : null;
  return {
    login: true, design: true, loginLabel,
    adjacent: designBlock.previousElementSibling === signInBlock,
    sameCard: designBlock.parentElement === signInBlock.parentElement,
    loginBox: rectOf(signInBlock), designBox: rectOf(designBlock),
    description: designBlock.textContent.includes(${JSON.stringify(DESCRIPTION)}),
    buttonLabel: button ? button.textContent.trim() : null,
  };
})()`;

/** The settings pane is a nested scroller, so a row has to be brought into view the way a reader brings
 *  it there before it can be photographed whole or pressed for real. */
const SCROLL_TO_ROW = `(() => {${ROW_HELPERS}
  const block = designRowBlock();
  if (!block) return false;
  block.scrollIntoView({ block: 'center' });
  return true;
})()`;

/** The design row's button centre, read after the scroll has landed. */
const DESIGN_BUTTON_BOX = `(() => {${ROW_HELPERS}
  const block = designRowBlock();
  const button = block ? block.querySelector('button') : null;
  return button ? centreOf(button) : null;
})()`;

/** The same scroll and the same reading for the sign-in row, so the second half of the walk presses a
 *  real pointer on a row that is really on screen rather than an off-screen button's coordinates. */
const SCROLL_TO_LOGIN = `(() => {${ROW_HELPERS}
  const block = loginRowBlock();
  if (!block) return false;
  block.scrollIntoView({ block: 'center' });
  return true;
})()`;

/** The sign-in row's button centre: Re-login, or Login on an account that is not signed in yet. */
const LOGIN_BUTTON_BOX = `(() => {${ROW_HELPERS}
  const block = loginRowBlock();
  const button = block ? block.querySelector('button') : null;
  return button ? centreOf(button) : null;
})()`;

/** The modal's own title, reached through the close button it is the sibling of — the account pane behind
 *  it has h3s of its own, so a bare `h3` would answer with the wrong heading. */
const MODAL_TITLE_READING = `(() => {
  const close = document.querySelector('button[aria-label="Close login modal"]');
  if (!close || close.getClientRects().length === 0) return null;
  const heading = close.parentElement ? close.parentElement.querySelector('h3') : null;
  return heading ? heading.textContent.trim() : null;
})()`;
const MODAL_CLOSE_CENTRE = `(() => { const close = document.querySelector('button[aria-label="Close login modal"]');
  if (!close) return null; const rect = close.getBoundingClientRect();
  return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 }; })()`;
const TERMINAL_MOUNTED = `document.querySelector('.xterm') !== null`;
/** The settings dialog, told apart from the app behind it by the heading only it draws. */
const DIALOG_UP = `Array.from(document.querySelectorAll('h2')).some((node) => node.getClientRects().length > 0)`;

/**
 * Whether the connection card has stopped asking. The sign-in row's title and the badge beside it are
 * both painted from the provider's auth status, which arrives over the network: read before it lands, the
 * pane says `Login` and `Checking...`, and a screenshot of that is a screenshot of the app before the
 * feature it is proving has anything to sit under. A wait rather than a failure — the row's own
 * assertions hold in either state, and a status that never lands is not this feature's fault.
 */
const AUTH_SETTLED = `(() => {${ROW_HELPERS}
  // The card has to be there first: with nothing painted yet, "nothing is asking" is true of an empty
  // pane, and the poll would settle on the frame before the account was ever rendered.
  if (!smallest('Login') && !smallest('Re-authenticate')) return false;
  return !Array.from(document.querySelectorAll('div, span')).some((node) => {
    if (node.getClientRects().length === 0) return false;
    const text = node.textContent.trim();
    return text === 'Checking...' || text.startsWith('Checking authentication status');
  });
})()`;

/**
 * What the terminal of the modal that was just opened has drawn, read off the output the server sent down
 * `/shell` (see the header): the design sign-in URL, whether it asks for the design scope, which of the
 * two panels answered, whether that answer was a reattach, and the three ways those commands are known to
 * fail — the refusal this flow would hit inside a Claude Code session, the refusal a non-interactive
 * session gets, and the unknown-command error an unrecognized slash command produces.
 *
 * Only the frames that arrived after `window.__shellMark` are read, so a modal opened over a pty the
 * PREVIOUS modal left parked cannot answer with that pty's replayed buffer and be believed.
 *
 * The URL ends at the first control character after it, which is the OSC 8 hyperlink's own terminator:
 * the command prints the sign-in link wrapped in one, and the reply is redrawn several times as the
 * terminal reflows, so a scan that ran on would splice three copies of the link together.
 */
const TERMINAL_READING = `(() => {
  const frames = (window.__shellFrames || []).slice(window.__shellMark || 0);
  const text = frames.join('');
  const at = text.indexOf('https://claude.com/');
  let url = '';
  if (at >= 0) {
    const stop = [32, 10, 13, 27, 7, 34, 60]; // space, LF, CR, ESC, BEL, quote, '<'
    let end = at;
    while (end < text.length && !stop.includes(text.charCodeAt(end))) end += 1;
    url = text.slice(at, end);
  }
  return {
    frames: frames.length,
    bytes: text.length,
    url,
    designScope: url.includes('user%3Adesign%3Aread'),
    designPanel: text.includes(${JSON.stringify(DESIGN_PANEL_MARKER)}),
    accountPanel: text.includes(${JSON.stringify(ACCOUNT_PANEL_MARKER)}),
    reattach: text.includes(${JSON.stringify(REATTACH_BANNER)}),
    refusal: text.includes('not available from inside a Claude Code session'),
    nonInteractive: text.includes('cannot run in this non-interactive session'),
    unknown: /unknown command/i.test(text) || /Unknown slash command/i.test(text),
  };
})()`;

/** Marks the frame boundary the readings above are taken from: everything in the log now was drawn by an
 *  earlier modal, and everything after the next press is that press's own. */
const markFrames = (cdp, sessionId) => evaluate(
  cdp,
  sessionId,
  `(window.__shellMark = (window.__shellFrames || []).length, window.__shellMark)`,
);

/**
 * How many login ptys are alive right now, by the command each was spawned with — the one reading here
 * taken outside the browser, because it is the only one that can tell a spawn from a reattach (see the
 * header). `ps` reports the full argv of the pty's process, which is the command as it was written.
 */
function loginPtys() {
  const listing = execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8' });
  const commands = listing.split('\n').map((line) => line.trim());
  return {
    account: commands.filter((line) => line === LOGIN_COMMAND.account).length,
    design: commands.filter((line) => line === LOGIN_COMMAND.design).length,
  };
}

/** Flips the theme the one way this app applies it — the class on <html> — and waits two frames, so the
 *  screenshot is taken after the browser has painted the flip rather than between two styles. */
const SET_THEME = (dark) => `(async () => {
  document.documentElement.classList.${dark ? 'add' : 'remove'}('dark');
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return document.documentElement.classList.contains('dark');
})()`;

/** Photographs the viewport into `name` and prints where it landed. */
async function photograph(cdp, sessionId, name) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const file = path.join(SHOT_DIR, `${name}.png`);
  await writeFile(file, Buffer.from(shot.data, 'base64'));
  print(`SHOT_${name.toUpperCase().replace(/-/g, '_')}`, file);
}

/** The scenario, returning `{ ok, reason }` or throwing. Leaving the box clean is `main`'s job. */
async function scenario(cdp, sessionId) {
  await cdp.send('Page.navigate', { url: appUrl }, sessionId);
  if (!await waitFor(cdp, sessionId, 'document.readyState === "complete"')) return { ok: false, reason: `${appUrl} never finished loading` };
  if (!await waitFor(cdp, sessionId, `Boolean(${SETTINGS_BUTTON})`)) {
    // A password field is the app asking to sign in, which almost always means the token was refused —
    // a far more useful thing to say than "the sidebar never painted".
    const signIn = await evaluate(cdp, sessionId, `document.querySelector('input[type="password"]') !== null`);
    return { ok: false, reason: signIn ? 'the app is asking to sign in, so the token was refused' : 'the app never painted its sidebar Settings row' };
  }
  print('BOOT', 1);

  // 1 — Settings, opened the way a reader opens it. Agents → Claude → Account is the dialog's default
  //     landing place, so the walk presses nothing else inside it.
  const settings = await evaluate(cdp, sessionId, boxOf(SETTINGS_BUTTON));
  if (!settings) return fail('DIALOG=0', 'the Settings row has no box to press');
  await clickAt(cdp, sessionId, { x: settings.cx, y: settings.cy });

  // 2 — the new row, and where it sits. The connection card is waited on first, so the reading describes
  //     the settled pane the screenshots below will show rather than the one it paints while the status is
  //     still in flight. The first row reading is then taken OUTSIDE its poll, so a reading that cannot be
  //     taken at all — a malformed expression, a document mid-swap — is reported as itself rather than as
  //     a row that never appeared.
  const settled = await waitFor(cdp, sessionId, AUTH_SETTLED, SETTLE_MS);
  print('AUTH_SETTLED', settled ? 1 : 0);
  let rows = await evaluate(cdp, sessionId, ACCOUNT_ROWS);
  const painted = Boolean(rows && rows.login && rows.design) || await waitFor(cdp, sessionId, async () => {
    rows = await evaluate(cdp, sessionId, ACCOUNT_ROWS);
    return Boolean(rows && rows.login && rows.design);
  }, SETTLE_MS);
  const dialogUp = await evaluate(cdp, sessionId, DIALOG_UP);
  print('DIALOG', dialogUp ? 1 : 0);
  if (!painted && !dialogUp) return fail('DIALOG=0', 'a real press on the Settings row opened no dialog');
  if (!painted) {
    return fail('ROW=0', rows && rows.login
      ? `the account pane draws the ${rows.loginLabel} row and no ${JSON.stringify(TITLE)} row`
      : 'the account pane never drew a sign-in row for the design row to sit under');
  }
  print('LOGIN_ROW', rows.loginLabel);
  print('DESIGN_ROW', 1);
  print('ROW_UNDER_LOGIN', rows.adjacent && rows.sameCard && rows.designBox.top >= rows.loginBox.bottom - 1 ? 1 : 0);
  print('DESIGN_DESCRIPTION', rows.description ? 1 : 0);
  print('DESIGN_BUTTON', rows.buttonLabel);
  if (!rows.adjacent) return { ok: false, reason: `the ${JSON.stringify(TITLE)} row is not the sign-in row's next sibling` };
  if (!rows.sameCard) return { ok: false, reason: 'the two rows are not in the same card' };
  if (rows.designBox.top < rows.loginBox.bottom - 1) return { ok: false, reason: `the design row starts at ${rows.designBox.top}px, above the sign-in row's ${rows.loginBox.bottom}px` };
  if (!rows.description) return { ok: false, reason: `the row does not carry its description (${JSON.stringify(DESCRIPTION)}…)` };
  if (rows.buttonLabel !== BUTTON) return { ok: false, reason: `the row's button reads ${JSON.stringify(rows.buttonLabel)} rather than ${JSON.stringify(BUTTON)}` };

  // 3 — the account pane as it now reads, in the two themes and at both widths. The theme is put back
  //     before the modal is opened, so the terminal is photographed in whatever the operator's is.
  const bootTheme = await evaluate(cdp, sessionId, `document.documentElement.classList.contains('dark')`);
  print('BOOT_THEME', bootTheme ? 'dark' : 'light');
  await mkdir(SHOT_DIR, { recursive: true });
  await evaluate(cdp, sessionId, SCROLL_TO_ROW);
  await setViewport(cdp, sessionId, DESKTOP);
  await evaluate(cdp, sessionId, SET_THEME(true));
  await photograph(cdp, sessionId, 'account-desktop-dark');
  await evaluate(cdp, sessionId, SET_THEME(false));
  await photograph(cdp, sessionId, 'account-desktop-light');
  await setViewport(cdp, sessionId, PHONE);
  await evaluate(cdp, sessionId, SCROLL_TO_ROW);
  await evaluate(cdp, sessionId, SET_THEME(true));
  await photograph(cdp, sessionId, 'account-phone-dark');
  await evaluate(cdp, sessionId, SET_THEME(false));
  await photograph(cdp, sessionId, 'account-phone-light');
  await evaluate(cdp, sessionId, SET_THEME(bootTheme));
  await setViewport(cdp, sessionId, DESKTOP);
  if (!await waitFor(cdp, sessionId, `Boolean(${SETTINGS_BUTTON})`)) return fail('RESIZED=0', 'the app lost its sidebar when the viewport was put back');
  await evaluate(cdp, sessionId, SCROLL_TO_ROW);

  // 4 — the design row's own button, pressed with a real pointer at 1280x900. This is the cold half of
  //     the pair: no login pty exists yet in this run, so what the terminal below draws is either this
  //     press's own command or a session left parked by someone else — and the three readings taken here
  //     say which. `__shellMark` bounds the frames to this press, the repo's pty keying must not have
  //     answered with the reattach banner, and `ps` must show one more design-login process than before.
  const target = await evaluate(cdp, sessionId, DESIGN_BUTTON_BOX);
  if (!target) return fail('MODAL=0', 'the design row has no button with a box to press');
  const designPtysBefore = loginPtys();
  await markFrames(cdp, sessionId);
  await clickAt(cdp, sessionId, { x: target.cx, y: target.cy });
  if (!await waitFor(cdp, sessionId, `(${MODAL_TITLE_READING}) !== null`)) return fail('MODAL=0', 'a real press on Authenticate opened no login modal');
  const title = await evaluate(cdp, sessionId, MODAL_TITLE_READING);
  print('MODAL_TITLE', title);
  if (title !== MODAL_TITLE) return { ok: false, reason: `the modal is titled ${JSON.stringify(title)} rather than ${JSON.stringify(MODAL_TITLE)}` };

  // 5 — the terminal. The pty is spawned by the server, so this is also where the CLAUDECODE question is
  //     answered: the modal's command inherits the API's own environment, not a Claude session's.
  if (!await waitFor(cdp, sessionId, TERMINAL_MOUNTED, SETTLE_MS)) return fail('TERMINAL=0', 'the modal mounted no terminal');
  let reading = null;
  const answered = await waitFor(cdp, sessionId, async () => {
    reading = await evaluate(cdp, sessionId, TERMINAL_READING);
    // A reattach settles this at once rather than after the full boot wait: it is the failure this walk
    // was rebuilt to name, and the replay it answers with carries a URL that would otherwise satisfy it.
    return Boolean(reading && (reading.url || reading.reattach));
  }, TERMINAL_WAIT_MS);
  print('TERMINAL', 1);
  print('SHELL_FRAMES', reading ? reading.frames : 0);
  print('SHELL_BYTES', reading ? reading.bytes : 0);
  print('DESIGN_URL', reading && reading.url ? reading.url : '');
  print('DESIGN_SCOPE', reading && reading.designScope ? 1 : 0);
  print('DESIGN_PANEL', reading && reading.designPanel ? 1 : 0);
  print('ACCOUNT_PANEL_IN_DESIGN', reading && reading.accountPanel ? 1 : 0);
  print('DESIGN_ATTACH', reading && reading.reattach ? 'reconnect' : 'spawn');
  print('SESSION_REFUSAL', reading && reading.refusal ? 1 : 0);
  print('NON_INTERACTIVE_REFUSAL', reading && reading.nonInteractive ? 1 : 0);
  print('UNKNOWN_COMMAND', reading && reading.unknown ? 1 : 0);
  const designPtysAfter = loginPtys();
  print('DESIGN_STEP_PTYS', `account ${designPtysBefore.account}->${designPtysAfter.account} design ${designPtysBefore.design}->${designPtysAfter.design}`);
  if (!answered) {
    return { ok: false, reason: reading && reading.frames === 0
      ? 'the terminal drew nothing at all: no frame came down the shell socket'
      : `the terminal never printed a claude.com sign-in URL (${reading ? reading.bytes : 0} bytes of output)` };
  }
  if (reading.reattach) return { ok: false, reason: 'the terminal reattached to a pty already parked on this key instead of starting the command the row names — it replayed another session\'s output' };
  if (designPtysAfter.design !== designPtysBefore.design + 1) {
    return { ok: false, reason: `the press started no design-login process: ${designPtysBefore.design} were running before it and ${designPtysAfter.design} after` };
  }
  if (designPtysAfter.account !== designPtysBefore.account) return { ok: false, reason: 'the press changed how many account-login processes are running, which is the other row\'s pty' };
  if (reading.accountPanel) return { ok: false, reason: 'the design modal answered with the account login panel rather than Claude Design\'s' };
  if (!reading.designPanel) return { ok: false, reason: 'the terminal drew a sign-in URL but not Claude Design\'s own panel' };
  if (!reading.designScope) return { ok: false, reason: `the sign-in URL does not ask for the design scope: ${reading.url}` };
  if (reading.refusal) return { ok: false, reason: 'the command was refused for running inside a Claude Code session' };
  if (reading.nonInteractive) return { ok: false, reason: 'the command was refused for running in a non-interactive session' };
  if (reading.unknown) return { ok: false, reason: 'the terminal reports an unknown command rather than a sign-in prompt' };

  // 6 — the modal itself, and then the way out. The sign-in is never completed: the operator does that.
  //     Closing leaves the design pty parked for its 30 minutes, which is the state the second half of
  //     this walk needs: the sign-in row below is now pressed while the OTHER row's pty is in the slots,
  //     and the two must still be two.
  await photograph(cdp, sessionId, 'modal-desktop');
  const close = await evaluate(cdp, sessionId, MODAL_CLOSE_CENTRE);
  if (!close) return fail('CLOSED=0', 'the modal has no close button with a box to press');
  await clickAt(cdp, sessionId, { x: close.cx, y: close.cy });
  const closed = await waitFor(cdp, sessionId, `(${MODAL_TITLE_READING}) === null`, SETTLE_MS);
  print('CLOSED', closed ? 1 : 0);
  if (!closed) return { ok: false, reason: 'the modal stayed open after a real press on its close button' };
  const mounted = await waitFor(cdp, sessionId, TERMINAL_MOUNTED, SETTLE_MS);
  if (mounted) return { ok: false, reason: 'the modal closed and left its terminal mounted' };

  // 7 — the same press on the sign-in row above it. This is where a shared pty slot shows itself: if the
  //     server keys these two commands to one session, this modal is handed the design pty that step 5
  //     just parked, answers with `[Reconnected to existing session]` and replays Claude Design's prompt
  //     under the account's title. The account panel is a menu, not a URL, so it is read by its own text.
  await evaluate(cdp, sessionId, SCROLL_TO_LOGIN);
  const loginTarget = await evaluate(cdp, sessionId, LOGIN_BUTTON_BOX);
  if (!loginTarget) return fail('ACCOUNT_MODAL=0', 'the sign-in row has no button with a box to press');
  const accountPtysBefore = loginPtys();
  await markFrames(cdp, sessionId);
  await clickAt(cdp, sessionId, { x: loginTarget.cx, y: loginTarget.cy });
  if (!await waitFor(cdp, sessionId, `(${MODAL_TITLE_READING}) !== null`)) return fail('ACCOUNT_MODAL=0', 'a real press on the sign-in row opened no login modal');
  const accountTitle = await evaluate(cdp, sessionId, MODAL_TITLE_READING);
  print('ACCOUNT_MODAL_TITLE', accountTitle);
  if (accountTitle !== ACCOUNT_MODAL_TITLE) return { ok: false, reason: `the sign-in row's modal is titled ${JSON.stringify(accountTitle)} rather than ${JSON.stringify(ACCOUNT_MODAL_TITLE)}` };
  if (!await waitFor(cdp, sessionId, TERMINAL_MOUNTED, SETTLE_MS)) return fail('ACCOUNT_TERMINAL=0', 'the sign-in modal mounted no terminal');
  let account = null;
  const accountAnswered = await waitFor(cdp, sessionId, async () => {
    account = await evaluate(cdp, sessionId, TERMINAL_READING);
    return Boolean(account && (account.accountPanel || account.designPanel || account.reattach));
  }, TERMINAL_WAIT_MS);
  print('ACCOUNT_TERMINAL', 1);
  print('ACCOUNT_FRAMES', account ? account.frames : 0);
  print('ACCOUNT_BYTES', account ? account.bytes : 0);
  print('ACCOUNT_PANEL', account && account.accountPanel ? 1 : 0);
  print('DESIGN_PANEL_IN_ACCOUNT', account && account.designPanel ? 1 : 0);
  print('ACCOUNT_ATTACH', account && account.reattach ? 'reconnect' : 'spawn');
  const accountPtysAfter = loginPtys();
  print('ACCOUNT_STEP_PTYS', `account ${accountPtysBefore.account}->${accountPtysAfter.account} design ${accountPtysBefore.design}->${accountPtysAfter.design}`);
  await photograph(cdp, sessionId, 'modal-account-desktop');
  if (!accountAnswered) {
    return { ok: false, reason: account && account.frames === 0
      ? 'the account modal\'s terminal drew nothing at all: no frame came down the shell socket'
      : `the account modal's terminal drew neither its own panel nor a reattach banner (${account ? account.bytes : 0} bytes of output)` };
  }
  if (account.reattach) return { ok: false, reason: 'the sign-in row reattached to the design pty parked by the walk above: the two rows share one pty slot' };
  if (account.designPanel) return { ok: false, reason: 'the sign-in modal answered with Claude Design\'s panel rather than the account login' };
  if (!account.accountPanel) return { ok: false, reason: 'the sign-in modal\'s terminal never drew the account login panel' };
  if (accountPtysAfter.account !== accountPtysBefore.account + 1) {
    return { ok: false, reason: `the press started no account-login process: ${accountPtysBefore.account} were running before it and ${accountPtysAfter.account} after` };
  }
  if (accountPtysAfter.design !== accountPtysBefore.design) return { ok: false, reason: 'the sign-in press changed how many design-login processes are running, which is the other row\'s pty' };
  const accountClose = await evaluate(cdp, sessionId, MODAL_CLOSE_CENTRE);
  if (!accountClose) return fail('ACCOUNT_CLOSED=0', 'the sign-in modal has no close button with a box to press');
  await clickAt(cdp, sessionId, { x: accountClose.cx, y: accountClose.cy });
  const accountClosed = await waitFor(cdp, sessionId, `(${MODAL_TITLE_READING}) === null`, SETTLE_MS);
  print('ACCOUNT_CLOSED', accountClosed ? 1 : 0);
  if (!accountClosed) return { ok: false, reason: 'the sign-in modal stayed open after a real press on its close button' };
  const unmounted = await waitFor(cdp, sessionId, TERMINAL_MOUNTED, SETTLE_MS);
  print('TERMINAL_UNMOUNTED', unmounted ? 0 : 1);
  if (unmounted) return { ok: false, reason: 'the sign-in modal closed and left its terminal mounted' };
  return { ok: true };
}

/**
 * Launches, seeds the token, and walks the scenario. It returns `{ ok, reason }`, never an exit: leaving
 * has to happen where the browser is shut down.
 */
async function main() {
  try {
    const token = mintToken();
    const launched = await launchBrowser();
    browser = launched;
    const socket = new WebSocket((await (await fetch(`http://127.0.0.1:${launched.port}/json/version`)).json()).webSocketDebuggerUrl);
    await once(socket, 'open');
    const cdp = new Cdp(socket);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);

    // Console errors, read from the browser rather than from a wrapper in the page. Enabled before the
    // first navigation so nothing the app says while booting is missed, and collected across reloads.
    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type !== 'error') return;
      consoleErrors.push(params.args.map((arg) => (arg.value === undefined ? (arg.description ?? arg.type) : String(arg.value))).join(' '));
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      consoleErrors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text ?? 'an exception');
    });
    cdp.on('Log.entryAdded', (params) => {
      if (params.entry.level === 'error') consoleErrors.push(`${params.entry.source}: ${params.entry.text}`);
    });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);

    // What this probe installs in the page, both as an init script so they are in place before the app's
    // own bundle runs.
    //
    // A tap on every `/shell` socket's messages, because the terminal renders to a canvas and its text is
    // not in the DOM. And the session token, written before the app's first request rather than after a
    // first unauthenticated load: seeding it from the outside costs a reload AND a boot with no credential,
    // whose rejected requests are console errors this probe would then have to explain away as its own.
    // The write is guarded because it is also attempted on `about:blank`, where localStorage belongs to
    // nobody; the document that matters — the app's own — runs this script again with its origin set.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        try { localStorage.setItem('auth-token', ${JSON.stringify(token)}); } catch { /* an opaque origin has no storage to seed */ }
        // The boundary every terminal reading is taken from: frames before it were drawn by an earlier
        // modal, frames after it by the press being proved. Moved by \`markFrames\` before each press.
        window.__shellMark = 0;
        const NativeSocket = window.WebSocket;
        class TappedSocket extends NativeSocket {
          constructor(url, protocols) {
            if (protocols === undefined) super(url); else super(url, protocols);
            if (String(url).includes('/shell')) {
              window.__shellFrames = window.__shellFrames || [];
              this.addEventListener('message', (event) => {
                // The DECODED output, not the frame: a frame is a JSON envelope whose payload escapes
                // its control characters, so reading the envelope would leave an OSC terminator as the
                // six characters \\u0007 and every reading below would have to know that.
                const frame = String(event.data);
                let text = frame;
                try {
                  const parsed = JSON.parse(frame);
                  if (parsed && typeof parsed.data === 'string') text = parsed.data;
                } catch { /* not a JSON envelope: a close frame, or something this terminal does not read */ }
                // Capped so a chatty spinner cannot grow the page without bound. The sign-in URL is the
                // first thing the command prints, long before this many frames could arrive.
                if (window.__shellFrames.length < 40000) window.__shellFrames.push(text);
              });
            }
          }
        }
        window.WebSocket = TappedSocket;
      })();`,
    }, sessionId);

    // Before the first reading, not after: the account pane's layout differs below `md`.
    await setViewport(cdp, sessionId, DESKTOP);
    const outcome = await scenario(cdp, sessionId);

    // Read AFTER the walk, so the count covers booting the app, opening the pane, running the terminal and
    // closing the modal — every moment of the walk, and not a compile-time subset of it.
    print('CONSOLE_ERRORS', consoleErrors.length);
    for (const message of consoleErrors.slice(0, 5)) console.error(`  console: ${message}`);
    if (outcome.ok && consoleErrors.length > 0) return { ok: false, reason: `${consoleErrors.length} console error(s), the first: ${consoleErrors[0]}` };
    return outcome;
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
