import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { findCodexLauncher } from '@/modules/providers/list/codex/codex-app-server.client.js';
import { commandRuns } from '@/modules/providers/shared/auth/command-runs.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type CodexCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

export class CodexProviderAuth implements IProviderAuth {
  /**
   * Checks whether Codex is available to the server runtime.
   */
  private checkInstalled(): Promise<boolean> {
    // The launcher in node_modules, not a `codex` on PATH: that is the binary a run actually uses.
    const launcher = findCodexLauncher();
    return launcher ? commandRuns(process.execPath, [launcher, '--version']) : Promise.resolve(false);
  }

  /**
   * Returns Codex SDK availability and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = await this.checkInstalled();
    const credentials = await this.checkCredentials(installed);

    return {
      installed,
      provider: 'codex',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Checks Codex's auth.json for OAuth tokens or a stored API key, then the environment's API key.
   */
  private async checkCredentials(installed: boolean): Promise<CodexCredentialsStatus> {
    const fromFile = await this.checkCredentialsFile();
    if (fromFile.authenticated) {
      return fromFile;
    }

    // Codex also runs on an API key taken straight from the environment, with no auth.json at all.
    // Only with Codex installed: `OPENAI_API_KEY` is exported for plenty of other tools, and on its
    // own it is no sign that Codex can run here.
    const envKey = installed && ['CODEX_API_KEY', 'OPENAI_API_KEY'].find((key) => process.env[key]?.trim());
    if (envKey) {
      return { authenticated: true, email: envKey, method: 'environment' };
    }
    return fromFile;
  }

  /** Reads `auth.json` from `CODEX_HOME`, else `~/.codex`. */
  private async checkCredentialsFile(): Promise<CodexCredentialsStatus> {
    try {
      const authPath = path.join(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex'), 'auth.json');
      const content = await readFile(authPath, 'utf8');
      const auth = readObjectRecord(JSON.parse(content)) ?? {};
      const tokens = readObjectRecord(auth.tokens) ?? {};
      const idToken = readOptionalString(tokens.id_token);
      const accessToken = readOptionalString(tokens.access_token);

      if (idToken || accessToken) {
        return {
          authenticated: true,
          email: idToken ? this.readEmailFromIdToken(idToken) : 'Authenticated',
          method: 'credentials_file',
        };
      }

      if (readOptionalString(auth.OPENAI_API_KEY)) {
        return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
      }

      return { authenticated: false, email: null, method: null, error: 'No valid tokens found' };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        authenticated: false,
        email: null,
        method: null,
        error: code === 'ENOENT' ? 'Codex not configured' : error instanceof Error ? error.message : 'Failed to read Codex auth',
      };
    }
  }

  /**
   * Extracts the user email from a Codex id_token when a readable JWT payload exists.
   */
  private readEmailFromIdToken(idToken: string): string {
    try {
      const parts = idToken.split('.');
      if (parts.length >= 2) {
        const payload = readObjectRecord(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
        return readOptionalString(payload?.email) ?? readOptionalString(payload?.user) ?? 'Authenticated';
      }
    } catch {
      // Fall back to a generic authenticated marker if the token payload is not readable.
    }

    return 'Authenticated';
  }
}
