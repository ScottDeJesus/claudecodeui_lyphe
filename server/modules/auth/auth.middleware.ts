// @ts-nocheck -- JWT request augmentation is narrowed by Auth route contracts.
import jwt from 'jsonwebtoken';

import { IS_PLATFORM } from '@/shared/utils.js';

import { userDb, appConfigDb } from '../database/index.js';

// Use env var if set, otherwise auto-generate a unique secret per installation
const JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// The request's path with its query cut off: SSE and clone-progress requests carry the token in
// `?token=`, and a log line must never hold any part of one.
const pathForLog = (req) => String(req.originalUrl || req.url || '').split('?')[0];

// jwt.verify messages that are fixed sentences. Any other message can embed a fragment of the
// token it choked on (a JSON parse error quotes its input), so it is logged as 'other'.
const SAFE_VERIFY_MESSAGES = new Set([
  'jwt malformed',
  'invalid token',
  'invalid signature',
  'jwt signature is required',
  'invalid algorithm',
  'jwt not active',
]);

// How a jwt.verify failure (always a JsonWebTokenError here) is filed in the trace line. Names the
// SHAPE of the refusal only.
const classifyTokenFailure = (error) => {
  if (error instanceof jwt.TokenExpiredError) return 'expired';
  if (error instanceof jwt.NotBeforeError) return 'not-active';
  if (error instanceof jwt.JsonWebTokenError && error.message === 'invalid signature') return 'bad-signature';
  return 'malformed';
};

/**
 * Every 401 that tells the browser to drop its session ends here, so each one leaves exactly one
 * line in the journal: route, reason and where the token came from — never the token itself.
 *
 * `X-Auth-Error` is what makes src/shared/api.ts sign the page out, which makes these four
 * refusals the only server-side causes of a sign-out; without a line per refusal the journal could
 * not tell which one ended a session (three of the four used to log nothing).
 */
const refuseAuth = (req, res, { reason, source, header, code, message, detail }) => {
  const extra = detail ? ` ${detail}` : '';
  console.warn(`[auth] 401 ${req.method} ${pathForLog(req)} reason=${reason} source=${source}${extra}`);
  res.setHeader('X-Auth-Error', header);
  return res.status(401).json({ error: message, code });
};

/**
 * Answers the 401 for a token `jwt.verify` refused. Whatever it throws is about THIS token, of any
 * class: a payload that is not JSON surfaces as a plain SyntaxError rather than a JsonWebTokenError,
 * and answering that with a 503 would strand the person on a "server unreachable" screen holding a
 * token that can never verify. The message is logged only when it is one of the fixed sentences.
 */
const refuseUnverifiableToken = (req, res, source, error) => {
  const reason = classifyTokenFailure(error);
  if (reason === 'expired') {
    return refuseAuth(req, res, {
      reason,
      source,
      header: 'session-expired',
      code: 'AUTH_TOKEN_EXPIRED',
      message: 'Session expired. Please log in again.',
      detail: `expiredSecondsAgo=${Math.round((Date.now() - error.expiredAt.getTime()) / 1000)}`,
    });
  }

  return refuseAuth(req, res, {
    reason,
    source,
    header: 'invalid-token',
    code: 'AUTH_TOKEN_INVALID',
    message: 'Invalid token',
    detail: `detail="${SAFE_VERIFY_MESSAGES.has(error?.message) ? error.message : 'other'}"`,
  });
};

// JWT authentication middleware
const authenticateToken = async (req, res, next) => {
  // Platform mode:  use single database user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        return res.status(500).json({ error: 'Platform mode: No user found in database' });
      }
      req.user = user;
      return next();
    } catch (error) {
      console.error('Platform mode error:', error);
      return res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
    }
  }

  // Normal OSS JWT validation
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  let source = 'header';

  // Also check query param for SSE endpoints (EventSource can't set headers)
  if (!token && req.query.token) {
    token = req.query.token;
    source = 'query';
  }

  if (!token) {
    return refuseAuth(req, res, {
      reason: 'missing',
      source: 'none',
      header: 'invalid-token',
      code: 'AUTH_TOKEN_INVALID',
      message: 'Access denied. No token provided.',
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return refuseUnverifiableToken(req, res, source, error);
  }

  try {
    // Verify user still exists and is active
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return refuseAuth(req, res, {
        reason: 'user-not-found',
        source,
        header: 'invalid-token',
        code: 'AUTH_TOKEN_INVALID',
        message: 'Invalid token. User not found.',
        detail: `userId=${Number(decoded.userId)}`,
      });
    }

    // Auto-refresh: if token is past halfway through its lifetime, issue a new one
    if (decoded.exp && decoded.iat) {
      const now = Math.floor(Date.now() / 1000);
      const halfLife = (decoded.exp - decoded.iat) / 2;
      if (now > decoded.iat + halfLife) {
        const newToken = generateToken(user);
        res.setHeader('X-Refreshed-Token', newToken);
        // Never let a cache keep this response: a browser stores a response with all its headers and
        // hands the STORED X-Refreshed-Token back on every later 304 revalidation of the URL, days
        // after it was minted, and a client that adopts it moves its session backwards until it
        // reads as expired. (The client also refuses stale tokens; this stops them being created.)
        res.setHeader('Cache-Control', 'no-store');
      }
    }

    req.user = user;
    next();
  } catch (error) {
    // The token verified, so this is not its fault (a locked database, a throw in the lookup): that
    // is no verdict on the session, so it answers 503 WITHOUT `X-Auth-Error` — the header is what
    // signs a page out.
    console.error(`[auth] 503 ${req.method} ${pathForLog(req)} reason=lookup-error source=${source} detail="${error instanceof Error ? error.message : String(error)}"`);
    return res.status(503).json({
      error: 'Authentication is temporarily unavailable.',
      code: 'AUTH_UNAVAILABLE',
    });
  }
};

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: '3650d' }
  );
};

// WebSocket authentication function
const authenticateWebSocket = (token) => {
  // Platform mode: bypass token validation, return first user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (user) {
        return { id: user.id, userId: user.id, username: user.username };
      }
      return null;
    } catch (error) {
      console.error('Platform mode WebSocket error:', error);
      return null;
    }
  }

  // Normal OSS JWT validation
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Verify user actually exists in database (matches REST authenticateToken behavior)
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return null;
    }
    return { userId: user.id, username: user.username };
  } catch (error) {
    if (!(error instanceof jwt.TokenExpiredError)) {
      console.warn(
        'WebSocket token verification failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
    return null;
  }
};

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  JWT_SECRET
};
