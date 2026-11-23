// CloudCLI's adapter for the house's walk library (hooks/web_walk, SEAM 3): how a browser context is signed in, how it
// wears a theme from first paint, how the library knows the app is up, and how the navigation is reached on a phone.
// Every address arrives in env from the house registry (hooks/web_walk/apps.toml); none is written here.
import { pathToFileURL } from 'node:url';

const PREFERENCES_URL = /\/api\/user\/preferences(?:[?#].*)?$/;
/** The localStorage key of the session (src/shared/authToken.ts AUTH_TOKEN_KEY). */
const AUTH_TOKEN_KEY = 'auth-token';
const SIGN_IN_LIMIT_MS = 15_000;
const READY_LIMIT_MS = 45_000;
const UNFOLD_LIMIT_MS = 8_000;
/** The sessions home's address (src/shared/constants.ts SESSIONS_HOME_PATH), where a bare root lands. */
const SESSIONS_HOME_PATH = '/home';
/** The workspace's own root with a query, which the landing rule leaves on the workspace (see ready). */
const WORKSPACE_ADDRESS = '/?walk';
/**
 * What a walk's pages see of the dev account's stored preferences whatever the account holds: English labels (the
 * dictionary names things by their English words), an expanded sidebar and every rail button shown (the Views rail lives
 * there). Laid over the stored answer for this context only; nothing is written to the account.
 */
const WALK_PREFERENCES = Object.freeze({
  userLanguage: 'en',
  uiPreferences: Object.freeze({ sidebarVisible: true, hideFilesTab: false, hideGitTab: false, hideBrowserTab: false }),
});

/** A context signed in as the dev user: the token from {api}/api/auth/login seeded as localStorage auth-token. */
export async function context(browser, options, env) {
  const kit = await kitOf(env);
  const token = await signIn(env.api, kit.DEV_USER);
  const browserContext = await browser.newContext(options);
  await browserContext.addInitScript(([key, value]) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // A sandboxed frame has an opaque origin and no storage; it needs no token.
    }
  }, [AUTH_TOKEN_KEY, token]);
  // The third-party calls the kit answers itself (GitHub's anonymous quota), so the console holds the app's own errors only.
  for (const { pattern, body } of kit.STUBBED_REQUESTS ?? []) {
    await browserContext.route(pattern, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
  }
  return browserContext;
}

/** Pins the stored theme (follow-the-sun off) on this context's own preference reads, and draws the matching scheme. */
export async function theme(browserContext, name) {
  await browserContext.route(PREFERENCES_URL, async (route) => {
    // A walk never writes the account: a preference write from the page is answered here and sent nowhere.
    if (route.request().method() !== 'GET') return route.fulfill({ status: 200, json: { success: true } });
    let answer;
    try {
      answer = await route.fetch();
    } catch {
      // The API dropped the read (or the context is closing): the page gets what it would have got with no pin.
      return route.fallback();
    }
    const body = await answer.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return route.fulfill({ response: answer });
    const stored = body.preferences && typeof body.preferences === 'object' ? body.preferences : {};
    body.preferences = {
      ...stored,
      ...WALK_PREFERENCES,
      uiPreferences: { ...stored.uiPreferences, ...WALK_PREFERENCES.uiPreferences },
      theme: name,
      themeFollowsSun: false,
    };
    return route.fulfill({ response: answer, json: body });
  });
  browserContext.on('page', (page) => {
    page.emulateMedia({ colorScheme: name }).catch(() => null);
  });
}

/**
 * Resolves once the app is signed in and the workspace is on screen. A bare root opens on the sessions home, drawn over the
 * workspace (useHeldWorkspace's landing rule); an address with a query is left alone, so WORKSPACE_ADDRESS stands the
 * workspace itself on screen. Throws fault "sign-in" when the sign-in form shows, "app-down" when the app draws nothing.
 */
export async function ready(page, env) {
  const rail = page.getByRole('navigation', { name: 'Views', exact: true });
  const signInForm = page.locator('input[type="password"]');
  await waitFor(rail.or(signInForm).first(), 'attached', `the app drew no shell within ${READY_LIMIT_MS} ms at ${env.base}`);
  if (await signInForm.filter({ visible: true }).count()) {
    throw faulted('sign-in', `${env.base} drew its sign-in form: the dev user's token was not taken`);
  }
  if (new URL(page.url()).pathname === SESSIONS_HOME_PATH) await page.goto(new URL(WORKSPACE_ADDRESS, env.base).href);
  const workspace = rail.or(page.getByRole('button', { name: 'Open menu', exact: true })).filter({ visible: true }).first();
  await waitFor(workspace, 'visible', `the workspace did not show within ${READY_LIMIT_MS} ms at ${env.base}`);
}

async function waitFor(locator, state, why) {
  try {
    await locator.waitFor({ state, timeout: READY_LIMIT_MS });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    throw faulted('app-down', why);
  }
}

/** On a phone the Views rail is in the sidebar drawer: open it by its Open menu button. Docked, nothing is pressed. */
export async function unfold(page) {
  const views = page.getByRole('navigation', { name: 'Views', exact: true }).filter({ visible: true });
  if (await views.count()) return;
  const menu = page.getByRole('button', { name: 'Open menu', exact: true }).filter({ visible: true });
  if (!(await menu.count())) return;
  await menu.first().click();
  await views.first().waitFor({ state: 'visible', timeout: UNFOLD_LIMIT_MS });
}

async function kitOf(env) {
  if (!env.signin) throw faulted('sign-in', 'the registry row for cloudcli names no signin module');
  try {
    return await import(pathToFileURL(env.signin).href);
  } catch (error) {
    throw faulted('sign-in', `${env.signin} could not be loaded: ${error.message}`);
  }
}

async function signIn(api, user) {
  if (!user?.username || !user?.password) throw faulted('sign-in', 'the signin module exports no DEV_USER {username, password}');
  let response;
  try {
    response = await fetch(new URL('/api/auth/login', api), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: user.username, password: user.password }),
      signal: AbortSignal.timeout(SIGN_IN_LIMIT_MS),
    });
  } catch (error) {
    throw faulted('app-down', `${api} did not answer the sign-in: ${error.cause?.code ?? error.message}`);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.token !== 'string') {
    throw faulted('sign-in', `${api}/api/auth/login answered ${response.status} with no token for ${user.username}`);
  }
  return body.token;
}

function faulted(fault, why) {
  return Object.assign(new Error(why), { fault });
}
