import { AppError } from '@/shared/utils.js';

type AuthUser = {
  id: number | bigint;
  username: string;
};

type AuthLoginUser = AuthUser & { password_hash: string };

type AuthDependencies = {
  users: {
    hasUsers(): boolean;
    createUser(username: string, passwordHash: string): AuthUser;
    getUserByUsername(username: string): AuthLoginUser | undefined;
    updateLastLogin(userId: number): void;
  };
  transaction: {
    begin(): void;
    commit(): void;
    rollback(): void;
  };
  hashPassword(password: string): Promise<string>;
  comparePassword(password: string, passwordHash: string): Promise<boolean>;
  generateToken(user: AuthUser): string;
};

// The most events one report may carry, and the widest a logged value may be. A report is text a
// browser wrote, so it is bounded and cut down to a safe alphabet before it reaches the journal.
const MAX_REPORTED_EVENTS = 10;
const MAX_REPORTED_VALUE_LENGTH = 120;

/** One client-reported field as a journal-safe value: short, no whitespace, no quotes, no query string. */
function journalSafeValue(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return '-';
  }
  const cleaned = String(value).split('?')[0].replace(/[^A-Za-z0-9._:/@+=,-]/g, '_');
  return cleaned.slice(0, MAX_REPORTED_VALUE_LENGTH) || '-';
}

function numericUserId(userId: number | bigint): number {
  return Number(userId);
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/**
 * Creates the Auth application service around explicit persistence, crypto,
 * transaction, and token dependencies.
 */
export function createAuthService(dependencies: AuthDependencies) {
  return {
    getStatus() {
      return {
        needsSetup: !dependencies.users.hasUsers(),
        isAuthenticated: false,
      };
    },

    async register(usernameInput: unknown, passwordInput: unknown) {
      const username = typeof usernameInput === 'string' ? usernameInput : '';
      const password = typeof passwordInput === 'string' ? passwordInput : '';

      if (!username || !password) {
        throw new AppError('Username and password are required', {
          code: 'AUTH_CREDENTIALS_REQUIRED',
          statusCode: 400,
        });
      }
      if (username.length < 3 || password.length < 6) {
        throw new AppError(
          'Username must be at least 3 characters, password at least 6 characters',
          { code: 'AUTH_CREDENTIALS_TOO_SHORT', statusCode: 400 },
        );
      }

      dependencies.transaction.begin();
      try {
        if (dependencies.users.hasUsers()) {
          throw new AppError('User already exists. This is a single-user system.', {
            code: 'AUTH_USER_ALREADY_CONFIGURED',
            statusCode: 403,
          });
        }

        const passwordHash = await dependencies.hashPassword(password);
        const user = dependencies.users.createUser(username, passwordHash);
        const token = dependencies.generateToken(user);
        dependencies.transaction.commit();
        dependencies.users.updateLastLogin(numericUserId(user.id));

        return {
          success: true,
          user: { id: user.id, username: user.username },
          token,
        };
      } catch (error) {
        dependencies.transaction.rollback();
        if (isUniqueConstraintError(error)) {
          throw new AppError('Username already exists', {
            code: 'AUTH_USERNAME_CONFLICT',
            statusCode: 409,
          });
        }
        throw error;
      }
    },

    async login(usernameInput: unknown, passwordInput: unknown) {
      const username = typeof usernameInput === 'string' ? usernameInput : '';
      const password = typeof passwordInput === 'string' ? passwordInput : '';
      if (!username || !password) {
        throw new AppError('Username and password are required', {
          code: 'AUTH_CREDENTIALS_REQUIRED',
          statusCode: 400,
        });
      }

      const user = dependencies.users.getUserByUsername(username);
      const validPassword = user
        ? await dependencies.comparePassword(password, user.password_hash)
        : false;
      if (!user || !validPassword) {
        throw new AppError('Invalid username or password', {
          code: 'AUTH_INVALID_CREDENTIALS',
          statusCode: 401,
        });
      }

      dependencies.users.updateLastLogin(numericUserId(user.id));
      return {
        success: true,
        user: { id: user.id, username: user.username },
        token: dependencies.generateToken(user),
      };
    },

    getCurrentUser(user: unknown) {
      return { user };
    },

    refreshSession(user: unknown) {
      if (
        typeof user !== 'object'
        || user === null
        || !('id' in user)
        || !('username' in user)
        || (typeof user.id !== 'number' && typeof user.id !== 'bigint')
        || typeof user.username !== 'string'
      ) {
        throw new AppError('Authenticated user is required', {
          code: 'AUTH_USER_REQUIRED',
          statusCode: 401,
        });
      }

      return { token: dependencies.generateToken(user as AuthUser) };
    },

    /**
     * Writes the sign-out trace a browser kept since its last session into the journal.
     *
     * The browser records why it dropped (or, for a verdict it refused to obey, kept) a session in
     * its own storage, because the server cannot see a sign-out that no request carried; the next
     * authenticated page load hands the record here. Values are text the browser wrote — clipped and
     * cut to a safe alphabet, never trusted as structure, and never a token (the client records only
     * the shape of one).
     */
    recordClientAuthEvents(user: unknown, eventsInput: unknown) {
      const username = typeof user === 'object' && user !== null && 'username' in user
        ? journalSafeValue((user as { username: unknown }).username)
        : '-';
      const events = Array.isArray(eventsInput) ? eventsInput.slice(0, MAX_REPORTED_EVENTS) : [];
      for (const event of events) {
        const fields = typeof event === 'object' && event !== null ? event as Record<string, unknown> : {};
        const rendered = Object.keys(fields)
          .slice(0, 16)
          .map((key) => `${journalSafeValue(key)}=${journalSafeValue(fields[key])}`)
          .join(' ');
        console.warn(`[auth] client-report user=${username} ${rendered}`);
      }
      return { success: true, recorded: events.length };
    },

    logout() {
      return { success: true, message: 'Logged out successfully' };
    },
  };
}
