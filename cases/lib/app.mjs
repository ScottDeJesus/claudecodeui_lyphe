// app.mjs — the running chat app, reached the one way a case may reach it: with the checks token.
//
// Two origins, both on this box and both named by the repo's own .env, never by a number written here:
// the API on SERVER_PORT and the screen on VITE_PORT (the dev server, whose /api goes to that same server).
//
// Usage (cases/<area>/<name>.mjs):
//   import { api, apiWithNoToken, withPage } from "../lib/app.mjs";
//   const { status, json, text } = await api("/api/claude-updates");               // signed in
//   const refused = await apiWithNoToken("/api/claude-updates", { judge401: false }); // the case whose promise IS the 401
//   const page = await withPage(t, { viewport: { width: 1440, height: 900 } });      // signed in, past the boot screen
//
// `api` and `apiWithNoToken` are the kit's door (node/http.mjs: its options, its answer, and its three
// CANNOT RUN sentences) on the server's origin, the first carrying `Authorization: Bearer <the checks
// token>` on every request and the second no credential at all.
//
// THE CHECKS TOKEN is minted in this process, the way scripts/universe-token.mjs mints one: the app's own
// secret, read and never made, signs `{ userId, username }` (what auth.middleware.ts verifies) for ten
// minutes. Nothing is written to disk: a token file is a credential that outlives the case that needed it.
// The secret and the database are found in the order the server finds them (server/load-env.ts):
// the process's environment, then the repo's .env, then the app's own default. The user is the first
// active one by id, the same every run; an inactive user's token is a 401.
// Every case signs in with this token and no other way. No case fills the sign-in form.
//
// A 401 or a sign-in screen is never evidence of anything but a missing credential (MAN-7477). So the door
// ends a 401 CANNOT RUN unless the call says `judge401: false`, and `withPage` ends a page that shows the
// sign-in screen CANNOT RUN. A case cannot turn either into BROKEN. `withPage` also asks the server who the
// token is before it starts a browser: a server that is down ends the case there, in the door's own words,
// where the page would stand on its boot screen for 25 s and then draw a frame with nothing in it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CannotRun, KIT } from "./case.mjs";

const { door } = await import(pathToFileURL(`${KIT}/node/http.mjs`).href);

const REPO = fileURLToPath(new URL("../../", import.meta.url)); // this file is <repo>/cases/lib/app.mjs
const ENV_FILE = path.join(REPO, ".env");
const LOOPBACK = "127.0.0.1";
const SERVER_NAME = "the chat app's server";
const UI_NAME = "the chat app's dev server";

const DEFAULT_DATABASE = path.join(os.homedir(), ".cloudcli", "auth.db"); // server/load-env.ts's DEFAULT_DATABASE_PATH
const JWT_SECRET_ROW = "jwt_secret"; // the app_config key app-config.ts keeps the secret under
const TOKEN_LIFE = "10m";
const AUTH_TOKEN_KEY = "auth-token"; // src/shared/authToken.ts's AUTH_TOKEN_KEY, where the page keeps its session

const IDENTITY_ROUTE = "/api/auth/user"; // behind authenticateToken: answers who the token is, changes nothing
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const BOOT_TIMEOUT_MS = 30000;
// Read off the live page 2026-11-14 in its three states: the boot check held open, no token, the checks token.
const BOOT_SCREEN = '[role="status"]:has(img[alt="LypheCLI"])'; // AuthLoadingScreen.tsx
const TOAST_STACK = "[data-verve-toast-stack]"; // a child of #root beside every screen, the boot screen included
const SIGN_IN_SCREEN = 'form:has(input[autocomplete="current-password"])'; // LoginForm.tsx
/** Whatever the app draws once its boot check has answered: a screen under #root that is not the boot screen. */
const PAST_THE_BOOT_SCREEN = `#root > :not(${TOAST_STACK}):not(:has(${BOOT_SCREEN}))`;

const firstLine = (error) => String(error?.message ?? error).split(/\r\n|\r|\n/)[0];

/** api — one request to the running server, signed in with the checks token. The kit's door: `(path, call) → { status, json, text }`. */
export async function api(requestPath, call) {
  return (await signedInDoor())(requestPath, call);
}

/** apiWithNoToken — the same request carrying no credential, for the case that checks a route refuses the signed-out. */
export async function apiWithNoToken(requestPath, call) {
  return door(originOf("SERVER_PORT"), { name: SERVER_NAME })(requestPath, call);
}

/**
 * withPage — a Chromium page on the app's dev server, signed in with the checks token and past the boot
 * screen. The browser is the repo's own `playwright`, closed by a cleanup deferred on `t` the moment it exists.
 * @param {{ defer: (cleanup: () => unknown) => void }} t the case's `t`, from `runCase`
 * @param {{ viewport?: { width: number, height: number } }} [options]
 */
export async function withPage(t, { viewport = DEFAULT_VIEWPORT } = {}) {
  const token = await checksToken();
  const uiOrigin = originOf("VITE_PORT");
  await api(IDENTITY_ROUTE); // CANNOT RUN here, by the door, when the server is down or refuses the token
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  t.defer(() => browser.close());
  const page = await browser.newPage({ viewport });
  // Before the app's first script, so its boot check finds a session. An init script also runs in every
  // frame the page opens: the origin test keeps the token out of the storage of any other origin's frame.
  await page.addInitScript(
    ({ origin, key, value }) => {
      if (window.location.origin === origin) window.localStorage.setItem(key, value);
    },
    { origin: uiOrigin, key: AUTH_TOKEN_KEY, value: token },
  );
  try {
    await page.goto(uiOrigin, { waitUntil: "domcontentloaded" });
  } catch (error) {
    throw new CannotRun(`${UI_NAME} did not answer — ${firstLine(error)}`);
  }
  await pastTheBootScreen(page);
  return page;
}

/**
 * Wait until the app has drawn something that is not its boot screen, then refuse the sign-in screen.
 * A wait that runs out is Playwright's own `Timeout <n>ms exceeded`, which the runner reads as a wait and
 * looks at a second time (hooks/cases/run.py, WAITED_OUT).
 */
async function pastTheBootScreen(page) {
  await page.locator(PAST_THE_BOOT_SCREEN).first().waitFor({ state: "attached", timeout: BOOT_TIMEOUT_MS });
  if ((await page.locator(SIGN_IN_SCREEN).count()) > 0) {
    throw new CannotRun("the app showed its sign-in screen — a missing credential, never a finding");
  }
}

// --------------------------------------------------------------------------- the two origins
let repoEnv = null;

/** The repo's .env as server/load-env.ts reads it: `NAME=value` lines, `#` comments and blanks passed by. */
function readRepoEnv() {
  if (repoEnv !== null) return repoEnv;
  let text;
  try {
    text = fs.readFileSync(ENV_FILE, "utf8");
  } catch (error) {
    throw new CannotRun(`the repo's .env would not read — ${error.code ?? firstLine(error)}`);
  }
  repoEnv = new Map();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const equals = trimmed.indexOf("=");
    if (trimmed.startsWith("#") || equals <= 0) continue;
    repoEnv.set(trimmed.slice(0, equals), trimmed.slice(equals + 1).trim());
  }
  return repoEnv;
}

/** `http://127.0.0.1:<the port .env names as portName>`. The port is the running app's, so only its .env says it. */
function originOf(portName) {
  const port = readRepoEnv().get(portName) ?? "";
  if (!/^\d{1,5}$/.test(port)) throw new CannotRun(`the repo's .env names no port as ${portName}`);
  return `http://${LOOPBACK}:${port}`;
}

/** What the server would read for `name`: its environment first, then the repo's .env; null when neither says. */
function serverSetting(name) {
  return process.env[name] || readRepoEnv().get(name) || null;
}

// --------------------------------------------------------------------------- the checks token
let minting = null;
let signingIn = null;

/** The checks token, minted once per process: every door of a case signs in as the same session. */
function checksToken() {
  minting ??= mintChecksToken();
  return minting;
}

function signedInDoor() {
  signingIn ??= checksToken().then((token) =>
    door(originOf("SERVER_PORT"), { name: SERVER_NAME, headers: { Authorization: `Bearer ${token}` } }),
  );
  return signingIn;
}

/**
 * Sign the first active user's `{ userId, username }` with the app's own secret. The two packages are the
 * repo's, loaded here and not at the top: one that will not load ends the case CANNOT RUN through `runCase`,
 * where a failed top-level import would exit 1, BROKEN's code, with no line.
 */
async function mintChecksToken() {
  const { default: Database } = await import("better-sqlite3");
  const { default: jwt } = await import("jsonwebtoken");
  const { user, storedSecret } = readIdentity(Database, serverSetting("DATABASE_PATH") ?? DEFAULT_DATABASE);
  if (!user) throw new CannotRun("the app's auth database holds no active user — nobody to sign in as");
  const secret = serverSetting("JWT_SECRET") ?? storedSecret;
  if (!secret) {
    throw new CannotRun(`no JWT secret — neither JWT_SECRET in the environment nor a ${JWT_SECRET_ROW} row in the app's auth database`);
  }
  return jwt.sign({ userId: user.id, username: user.username }, secret, { expiresIn: TOKEN_LIFE });
}

/** The user to sign in as and the stored secret, from the auth database opened read-only and closed again. */
function readIdentity(Database, databasePath) {
  let database;
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new CannotRun(`the app's auth database ${databasePath} would not open read-only — ${error.code ?? firstLine(error)}`);
  }
  try {
    const user = database.prepare("SELECT id, username FROM users WHERE is_active = 1 ORDER BY id LIMIT 1").get();
    const config = database.prepare("SELECT value FROM app_config WHERE key = ?").get(JWT_SECRET_ROW);
    return { user, storedSecret: config?.value ?? null };
  } catch (error) {
    throw new CannotRun(`the app's auth database ${databasePath} would not read — ${error.code ?? firstLine(error)}`);
  } finally {
    database.close();
  }
}
