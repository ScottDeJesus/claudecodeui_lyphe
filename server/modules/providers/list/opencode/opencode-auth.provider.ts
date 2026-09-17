import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readConnectedOpenCodeProviderIds } from '@/modules/providers/list/opencode/opencode-models.provider.js';
import { commandRuns } from '@/modules/providers/shared/auth/command-runs.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type OpenCodeCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

const OPENCODE_ENV_CREDENTIAL_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENCODE_API_KEY',
];

export class OpenCodeProviderAuth implements IProviderAuth {
  /**
   * Checks whether the OpenCode CLI is available to the server process.
   */
  private checkInstalled(): Promise<boolean> {
    return commandRuns('opencode', ['--version']);
  }

  /**
   * Returns OpenCode CLI installation and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = await this.checkInstalled();
    const credentials = await this.checkCredentials(installed);

    return {
      installed,
      provider: 'opencode',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * With OpenCode installed, reads its auth store, then provider API keys in the environment and the
   * providers its global config declares.
   */
  private async checkCredentials(installed: boolean): Promise<OpenCodeCredentialsStatus> {
    // Nothing counts without OpenCode installed: a login, an API key or a config file left behind
    // is no sign that it can run here, and the keys are shared with other tools.
    if (!installed) {
      return { authenticated: false, email: null, method: null, error: 'OpenCode is not installed' };
    }

    try {
      const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
      const content = await readFile(authPath, 'utf8');
      const auth = readObjectRecord(JSON.parse(content)) ?? {};

      for (const [providerId, providerAuth] of Object.entries(auth)) {
        const providerRecord = readObjectRecord(providerAuth);
        if (!providerRecord) {
          continue;
        }

        const hasCredential = Object.values(providerRecord).some(
          (value) => readOptionalString(value) !== undefined || Boolean(readObjectRecord(value)),
        );
        if (hasCredential) {
          return {
            authenticated: true,
            email: `${providerId} credentials`,
            method: 'credentials_file',
          };
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        return {
          authenticated: false,
          email: null,
          method: null,
          error: error instanceof Error ? error.message : 'Failed to read OpenCode auth',
        };
      }
    }

    const envCredential = OPENCODE_ENV_CREDENTIAL_KEYS.find((key) => process.env[key]?.trim());
    if (envCredential) {
      return {
        authenticated: true,
        email: envCredential,
        method: 'environment',
      };
    }

    // The same sweep the model list narrows by: a provider declared in OpenCode's global config
    // routes without any login, so an install the picker has models for is never read as signed out.
    const connected = await readConnectedOpenCodeProviderIds();
    if (connected) {
      return {
        authenticated: true,
        email: `${[...connected].join(', ')} configured`,
        method: 'config',
      };
    }

    return {
      authenticated: false,
      email: null,
      method: null,
      error: 'OpenCode not configured',
    };
  }
}
