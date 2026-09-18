#!/usr/bin/env node
// Load environment variables before other imports execute.
import './load-env.js';
import fs, { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';

import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';

import { AppError, findApplicationRoot, getModuleDirectory, IS_PLATFORM, terminalTextStyles } from '@/shared/utils.js';
import { createAppsModule } from '@/modules/apps/index.js';
import {
    initializeSessionsWatcher,
    providerRuntimeService,
    readoptKeepaliveSessions,
    releaseKeepaliveOwnership,
} from '@/modules/providers/index.js';
import { createWebSocketServer, startRunStallWatchdog } from '@/modules/websocket/index.js';

import { getConnectableHost } from '../shared/networkHosts.js';

import { handover, onTakeover, signalReady, supervised } from './supervised-boot.js';
import { createGitModule } from './modules/git/index.js';
import {
    authenticateToken,
    authenticateWebSocket,
    authRoutes,
    validateApiKey,
} from './modules/auth/index.js';
import { taskmasterRoutes } from './modules/taskmaster/index.js';
import { commandsRoutes } from './modules/commands/index.js';
import { settingsRoutes } from './modules/settings/index.js';
import { createSystemModule } from './modules/system/index.js';
import { createAgentModule } from './modules/agent/index.js';
import projectModuleRoutes from './modules/projects/projects.routes.js';
import notificationRoutes from './modules/notifications/notifications.routes.js';
import { userRoutes } from './modules/user/index.js';
import {
    getPluginPort,
    pluginsRoutes,
    startEnabledPluginServers,
    stopAllPlugins,
} from './modules/plugins/index.js';
import providerRoutes from './modules/providers/provider.routes.js';
import { voiceRoutes } from './modules/voice/index.js';
import {
    initializeScheduledMessageDispatcher,
    scheduledMessagesRoutes,
} from './modules/scheduled-messages/index.js';
import browserUseRoutes from './modules/browser-use/browser-use.routes.js';
import { assetsRoutes } from './modules/assets/index.js';
import { createAccountsModule } from './modules/accounts/index.js';
import { createCliVersionModule } from './modules/cli-version/index.js';
import { createDeepseekModule } from './modules/deepseek/index.js';
import { createKanbanModule, plansHeldByLease } from './modules/kanban/index.js';
import { createKanbanMetisModule, kanbanMetisSecretGuard } from './modules/kanban-metis/index.js';
import { createMemoryIntakeModule, listMemoryCandidates } from './modules/memory-intake/index.js';
import { createDispatchSoulsModule } from './modules/dispatch-souls/index.js';
import { createPlanRunnerModule, planCostFor } from './modules/plan-runner/index.js';
import { createUniverseModule } from './modules/universe/index.js';
import { fileTreeRoutes } from './modules/file-tree/index.js';
import { worktreesRoutes } from './modules/worktrees/index.js';
import browserUseMcpRoutes from './modules/browser-use/browser-use-mcp.routes.js';
import { browserUseService } from './modules/browser-use/browser-use.service.js';
import { initializeDatabase, sessionsDb } from './modules/database/index.js';
import { configureWebPush, createNtfyActionRoutes } from './modules/notifications/index.js';

const __dirname = getModuleDirectory(import.meta.url);
// The server source runs from /server, while the compiled output runs from /dist-server/server.
// Resolving the app root once keeps every repo-level lookup below aligned across both layouts.
const APP_ROOT = findApplicationRoot(__dirname);
const installMode = fs.existsSync(path.join(APP_ROOT, '.git')) ? 'git' : 'npm';
// Version of the code that is actually running, captured once at process
// startup. This intentionally does NOT re-read package.json per request: after
// an update replaces the files on disk, package.json reflects the NEW version
// while this long-lived process still runs the OLD code. The frontend bundle is
// rebuilt on update, so a mismatch between this value and the frontend's
// build-time version means the server was updated but not restarted.
const RUNNING_VERSION = (() => {
    try {
        return JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version || null;
    } catch {
        return null;
    }
})();
const systemRoutes = createSystemModule({
    appRoot: APP_ROOT,
    installMode,
    isPlatform: IS_PLATFORM,
});
console.log('SERVER_PORT from env:', process.env.SERVER_PORT);

const app = express();
const server = http.createServer(app);
const queryClaude = providerRuntimeService.getRunner('claude');
const queryCursor = providerRuntimeService.getRunner('cursor');
const queryCodex = providerRuntimeService.getRunner('codex');
const queryOpenCode = providerRuntimeService.getRunner('opencode');
const gitRoutes = createGitModule({
    queryClaude,
    queryCursor,
});
const agentRoutes = createAgentModule({
    queryClaude,
    queryCursor,
    queryCodex,
    queryOpenCode,
});

// Single WebSocket server that handles chat, shell, and plugin proxy paths.
createWebSocketServer(server, {
    verifyClient: {
        isPlatform: IS_PLATFORM,
        authenticateWebSocket,
    },
    chat: {
        runtime: providerRuntimeService,
    },
    shell: {
        resolveProviderSessionId: (sessionId, provider) => {
            const dbSession = sessionsDb.getSessionById(sessionId);
            if (dbSession) {
                return dbSession.provider_session_id ?? null;
            }

            return null;
        },
    },
    getPluginPort,
});

app.use(cors({ exposedHeaders: ['X-Refreshed-Token', 'X-Auth-Error'] }));
app.use(express.json({
    limit: '50mb',
    type: (req) => {
        // Skip multipart/form-data requests (for file uploads like images)
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            return false;
        }
        return contentType.includes('json');
    }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Public health check endpoint (no authentication required)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        installMode,
        version: RUNNING_VERSION
    });
});

// Optional API key validation (if configured)
app.use('/api', validateApiKey);

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// File Tree API Routes (protected)
app.use('/api/file-tree', authenticateToken, fileTreeRoutes);

// Projects API Routes (protected)
app.use('/api/projects', authenticateToken, projectModuleRoutes);

// Chat attachment upload/serving (global ~/.cloudcli/assets store, protected)
app.use('/api/assets', authenticateToken, assetsRoutes);

// Git API Routes (protected)
app.use('/api/git', authenticateToken, gitRoutes);

// Git worktree management (protected)
app.use('/api/worktrees', authenticateToken, worktreesRoutes);

// TaskMaster API Routes (protected)
app.use('/api/taskmaster', authenticateToken, taskmasterRoutes);

// Commands API Routes (protected)
app.use('/api/commands', authenticateToken, commandsRoutes);

// Settings API Routes (protected)
app.use('/api/settings', authenticateToken, settingsRoutes);

app.use('/api/system', authenticateToken, systemRoutes);

// The Claude account switcher and its usage meter (protected), mounted at `/api` so its four paths
// land at `/api/accounts`, `/api/usage`, `/api/accounts/switch` and `/api/accounts/capture`.
//
// ⚠ THE GUARD IS SCOPED TO THOSE FOUR PATHS, and that is deliberate: `app.use('/api', authenticateToken,
// …)` would run the JWT check in front of every mount declared BELOW this line as well — and
// `/api/kanban-pm` (a board Metis holds no user token), `/api/ntfy/act` (signed buttons), `/api/agent`
// and `/api/browser-use-mcp` are public by design. A bare `/api` mount here locks all four out.
// Scoped this way the guard covers the switcher and nothing else, wherever this line sits.
const ACCOUNT_PATHS = new Set(['/accounts', '/usage', '/accounts/switch', '/accounts/capture']);

app.use(
    '/api',
    (request, response, next) => {
        if (!ACCOUNT_PATHS.has(request.path)) return next();
        return authenticateToken(request, response, next);
    },
    createAccountsModule()
);

// The two readings the board cannot take for itself, built HERE because this is the one place that
// may reach across modules. The plan-runner owns what a plan cost — it reads the ledgers on disk —
// and the memory-intake lane owns how many candidates are waiting on a person; neither module
// imports the other, and the board imports neither of them.
//
// `memoryPending` is a REGISTER, not a page, so it asks the lane's read for no ceiling at all: the
// lane's list verb defaults to 100 rows, and a count taken off that page silently stops at 100 —
// measured on the probe, 105 pending candidates read as 100 while the queue held 105. The cap is
// the caller's to lift (the verb takes `limit`), and a count has no page to stop at. What remains
// is the lane's own read resolving a row's session id as it hands it back; that cost is the lane's
// shape, and a count verb of its own belongs in the lane's module, which this phase does not own.
const memoryPending = (): number =>
  listMemoryCandidates({ status: 'pending', limit: Number.MAX_SAFE_INTEGER }).length;
const kanbanReadings = { planCost: planCostFor, memoryPending };

// The Kanban board (protected). The guard rides the MOUNT rather than each route, so no file in
// the module imports `authenticateToken` and a sibling route package cannot forget it.
app.use('/api/kanban', authenticateToken, createKanbanModule(kanbanReadings));

// A board's own Metis: launching one by hand, watching her, stopping and resuming her (protected).
app.use('/api/kanban-metis', authenticateToken, createKanbanMetisModule());

// The memory-intake lane (protected), at ONE address and never on the board's router — so the second
// kanban mount a board Metis can reach cannot see it. Its proposals wait on a person's approval here,
// and nothing reaches a shelf or a project's memory directory until one is given.
app.use('/api/memory', authenticateToken, createMemoryIntakeModule());

// The SAME board router behind a second door, for the `kanban-pm` MCP child and nothing else —
// no verb is duplicated here, and there is deliberately NO `authenticateToken`: a Metis is not a
// user and holds no user token. `kanbanMetisSecretGuard` is that door's own credential check, on a
// secret derived from the session id, and it refuses the descent importer outright.
app.use('/api/kanban-pm', kanbanMetisSecretGuard, createKanbanModule(kanbanReadings));

// The applications this host serves, and the registry file the switcher's drawer reads (protected).
// The registry file is created at module creation, so it exists from the first boot.
app.use('/api/apps', authenticateToken, createAppsModule());

// Installed CLI version + what the live runs are on (protected)
app.use('/api/cli-version', authenticateToken, createCliVersionModule());

// The money left on this host's DeepSeek account (protected) — a different account from the
// Claude slots Descent holds, read from the vendor directly with the key in this host's .env.
app.use('/api/deepseek', authenticateToken, createDeepseekModule());

// The plan runner's live runs, and the relay for its own stop/resume (protected).
// Built once here rather than inline: the poll behind its websocket frame is started after
// `listen` and stopped on shutdown, so the module has to be something both can name.
//
// Its plans-archive sweep moves finished plans out of the corpus, and the one thing that must stop
// it is a card still building or planning against one — so the board answers which plans its leases
// hold (`plansHeldByLease`) and this is the single place the two modules are joined. The arrow
// points one way: the runner is handed a reading, and neither module imports the other.
const planRunner = createPlanRunnerModule({ heldPlanPaths: plansHeldByLease });
app.use('/api/plan-runner', authenticateToken, planRunner.router);

// The launcher souls a `/dispatch` started — the poll behind the `soul_launch_state` frame that
// pins each one in its own chat's rows (protected). Built out here for the same
// reason `planRunner` is: its poll starts after `listen` and stops on shutdown.
const dispatchSouls = createDispatchSoulsModule();
app.use('/api/dispatch-souls', authenticateToken, dispatchSouls.router);

// The estate map — every tracked file in the four crawled repos — and the watcher that rebuilds it
// when a repo's HEAD moves (protected; the map is the estate, and this app is reachable from a LAN).
// Built out here for the same reason again: its watcher starts after `listen` and stops on shutdown.
const universe = createUniverseModule();
app.use('/api/universe', authenticateToken, universe.router);

app.use('/api/notifications', authenticateToken, notificationRoutes);
app.use('/api/ntfy/act', createNtfyActionRoutes({ runtime: providerRuntimeService })); // Public: ntfy buttons authenticate by signed token, not JWT.

// User API Routes (protected)
app.use('/api/user', authenticateToken, userRoutes);

// Plugins API Routes (protected)
app.use('/api/plugins', authenticateToken, pluginsRoutes);

// Browser MCP bridge API (local token protected)
app.use('/api/browser-use-mcp', browserUseMcpRoutes);

// Browser API Routes (protected)
app.use('/api/browser-use', authenticateToken, browserUseRoutes);

// Unified provider MCP routes (protected)
app.use('/api/providers', authenticateToken, providerRoutes);
app.use('/api/scheduled-messages', authenticateToken, scheduledMessagesRoutes);

// Agent API Routes (uses API key authentication)
app.use('/api/agent', agentRoutes);

app.use('/api/voice', authenticateToken, voiceRoutes);

// Serve public files (like api-docs.html)
app.use(express.static(path.join(APP_ROOT, 'public')));

// Static files served after API routes
// Add cache control: HTML files should not be cached, but assets can be cached
app.use(express.static(path.join(APP_ROOT, 'dist'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            // Prevent HTML caching to avoid service worker issues after builds
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else if (filePath.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/)) {
            // Cache static assets for 1 year (they have hashed names)
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}));

// API Routes (protected)
// /api/config endpoint removed - no longer needed
// Frontend now uses window.location for WebSocket URLs

// Chat uploads live under /api/assets (server/modules/assets), which stores
// images and general files in the global ~/.cloudcli/assets folder.

// Serve React app for all other routes (excluding static files)
app.get('*', (req, res) => {
    // Skip requests for static assets (files with extensions)
    if (path.extname(req.path)) {
        return res.status(404).send('Not found');
    }

    // Only serve index.html for HTML routes, not for static assets
    // Static assets should already be handled by express.static middleware above
    const indexPath = path.join(APP_ROOT, 'dist', 'index.html');

    // Check if dist/index.html exists (production build available)
    if (fs.existsSync(indexPath)) {
        // Set no-cache headers for HTML to prevent service worker issues
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(indexPath);
    } else {
        // In development, redirect to Vite dev server only if dist doesn't exist
        const redirectHost = getConnectableHost(req.hostname);
        res.redirect(`${req.protocol}://${redirectHost}:${VITE_PORT}`);
    }
});

// global error middleware must be last
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  console.error(err);

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
});

const SERVER_PORT = Number.parseInt(process.env.SERVER_PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DISPLAY_HOST = getConnectableHost(HOST);
const VITE_PORT = process.env.VITE_PORT || 5173;
const LOCAL_SERVER_MARKER_PATH = path.join(os.homedir(), '.cloudcli', 'local-server.json');

function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return undefined;
    }
    return String(error.code);
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function writeLocalServerMarker() {
    const marker = {
        pid: process.pid,
        host: HOST,
        port: Number.parseInt(String(SERVER_PORT), 10),
        url: `http://${DISPLAY_HOST}:${SERVER_PORT}`,
        installMode,
        appRoot: APP_ROOT,
        updatedAt: new Date().toISOString(),
    };

    await fsPromises.mkdir(path.dirname(LOCAL_SERVER_MARKER_PATH), { recursive: true });
    await fsPromises.writeFile(LOCAL_SERVER_MARKER_PATH, JSON.stringify(marker, null, 2), 'utf8');
}

async function removeLocalServerMarker() {
    try {
        const raw = await fsPromises.readFile(LOCAL_SERVER_MARKER_PATH, 'utf8');
        const marker = JSON.parse(raw);
        if (marker.pid && marker.pid !== process.pid) return;
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') return;
    }

    try {
        await fsPromises.unlink(LOCAL_SERVER_MARKER_PATH);
    } catch (error) {
        if (getErrorCode(error) !== 'ENOENT') {
            console.warn('[WARN] Could not remove local server marker:', getErrorMessage(error));
        }
    }
}

// Once, never twice: readoptKeepaliveSessions is not idempotent — a second pass re-connects the
// hosts it already holds and severs the sockets the first pass adopted.
let soleServerDutiesRan = false;

/** The duties only the sole server on the port may perform; a handover boot waits for takeover. */
async function soleServerDuties() {
    if (soleServerDutiesRan) return;
    soleServerDutiesRan = true;
    try { // D-11: a browser that subscribes before this ran reads a live keepalive session as idle
        const keepalive = await readoptKeepaliveSessions({ runtime: providerRuntimeService, supervised });
        console.log(`[keepalive] re-adopted ${keepalive.readopted} host(s), swept ${keepalive.swept}`);
    } catch (error) { console.error('[keepalive] re-adopt failed (continuing):', getErrorMessage(error)); }
    // Sends anything that came due while the server was not running, then keeps polling.
    initializeScheduledMessageDispatcher(providerRuntimeService);
    // Start server-side plugin processes for enabled plugins
    startEnabledPluginServers().catch(err => {
        console.error('[Plugins] Error during startup:', err.message);
    });
}

// Stops the stall watchdog on shutdown. Assigned inside the `listen` callback that
// starts it, named out here because the shutdown path below has to reach it — the
// same reason `planRunner` is built at module scope.
let stopRunStallWatchdog: (() => void) | null = null;

// Initialize database and start server
async function startServer() {
    try {
        // Initialize authentication database
        await initializeDatabase();

        // Configure Web Push (VAPID keys)
        configureWebPush();

        // Check if running in production mode (dist folder exists)
        const distIndexPath = path.join(APP_ROOT, 'dist', 'index.html');
        const isProduction = fs.existsSync(distIndexPath);

        // Log Claude implementation mode
        console.log(`${terminalTextStyles.info('[INFO]')} Using Claude Agents SDK for Claude integration`);
        console.log('');

        if (isProduction) {
            console.log(`${terminalTextStyles.info('[INFO]')} To run in production mode, go to http://${DISPLAY_HOST}:${SERVER_PORT}`);
        }

        console.log(`${terminalTextStyles.info('[INFO]')} To run in development mode with hot-module replacement, go to http://${DISPLAY_HOST}:${VITE_PORT}`);
   
        if (!handover) await soleServerDuties();
        else console.log('[keepalive] re-adoption deferred until the previous server exits (handover boot)');
        server.listen({ port: SERVER_PORT, host: HOST, reusePort: supervised }, async () => {
            signalReady();
            const appInstallPath = APP_ROOT;
            await writeLocalServerMarker().catch((error) => {
                console.warn('[WARN] Could not write local server marker:', error.message);
            });

            console.log('');
            console.log(terminalTextStyles.dim('═'.repeat(63)));
            console.log(`  ${terminalTextStyles.bright('CloudCLI Server - Ready')}`);
            console.log(terminalTextStyles.dim('═'.repeat(63)));
            console.log('');
            console.log(`${terminalTextStyles.info('[INFO]')} Server URL:  ${terminalTextStyles.bright('http://' + DISPLAY_HOST + ':' + SERVER_PORT)}`);
            console.log(`${terminalTextStyles.info('[INFO]')} Installed at: ${terminalTextStyles.dim(appInstallPath)}`);
            console.log(`${terminalTextStyles.tip('[TIP]')}  Run "cloudcli status" for full configuration details`);
            console.log('');

            // Start watching the projects folder for changes
            await initializeSessionsWatcher();

            // Start polling the plan runner's state directory. After `listen`, because the
            // frames it broadcasts are for sockets this server is only now able to accept.
            planRunner.start();

            // The launcher souls, read off their own state root and broadcast the same way.
            dispatchSouls.start();

            // The estate's HEADs, watched so a commit is what announces the next map.
            universe.start();

            // Watch live runs for silence. Same placement and the same reason: the
            // notification it sends is about runs this server is now able to host.
            stopRunStallWatchdog = startRunStallWatchdog();
        });
        if (handover) onTakeover(soleServerDuties);

        // Clean up plugin processes on shutdown
        const shutdownRuntimeServices = async () => {
            // Stop accepting first: with reusePort the kernel would keep handing this exiting
            // process new connections. Never awaited — open WebSockets keep it from resolving.
            server.close();
            planRunner.stop();
            dispatchSouls.stop();
            universe.stop();
            stopRunStallWatchdog?.();
            try {
                await browserUseService.stopAllSessions();
            } catch (err) {
                console.error('[Browser] Error stopping sessions during shutdown:', getErrorMessage(err));
            }
            try {
                await stopAllPlugins();
            } catch (err) {
                console.error('[Plugins] Error stopping plugins during shutdown:', getErrorMessage(err));
            }
            try {
                releaseKeepaliveOwnership();
                await removeLocalServerMarker();
            } catch (err) {
                console.error('[Local Server] Error removing server marker during shutdown:', getErrorMessage(err));
            }
            process.exit(0);
        };
        process.on('SIGTERM', () => void shutdownRuntimeServices());
        process.on('SIGINT', () => void shutdownRuntimeServices());
    } catch (error) {
        console.error('[ERROR] Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
