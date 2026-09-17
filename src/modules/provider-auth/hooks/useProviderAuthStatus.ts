import { useCallback, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider, ProviderAuthStatus, ProviderAuthStatusMap } from '@/shared/types';

const CLI_PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

const createInitialProviderAuthStatusMap = (loading = true): ProviderAuthStatusMap => ({
  claude: { authenticated: false, email: null, method: null, error: null, loading },
  cursor: { authenticated: false, email: null, method: null, error: null, loading },
  codex: { authenticated: false, email: null, method: null, error: null, loading },
  opencode: { authenticated: false, email: null, method: null, error: null, loading },
});

type ProviderAuthStatusPayload = {
  authenticated?: boolean;
  email?: string | null;
  method?: string | null;
  error?: string | null;
};

type ProviderAuthStatusApiResponse = {
  success: boolean;
  data: ProviderAuthStatusPayload;
};

const FALLBACK_STATUS_ERROR = 'Failed to check authentication status';
const FALLBACK_UNKNOWN_ERROR = 'Unknown error';

const toErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : FALLBACK_UNKNOWN_ERROR
);

const toProviderAuthStatus = (
  payload: ProviderAuthStatusPayload,
  fallbackError: string | null = null,
): ProviderAuthStatus => ({
  authenticated: Boolean(payload.authenticated),
  email: payload.email ?? null,
  method: payload.method ?? null,
  error: payload.error ?? fallbackError,
  loading: false,
});

/**
 * Asks the server whether one provider is signed in, with no React state of its own. `answered`
 * is false when the check itself failed (an error response, a dropped request), which is not the
 * same as the server reporting the provider signed out; the status then carries the failure.
 */
export async function fetchProviderAuthStatus(
  provider: LLMProvider,
): Promise<{ answered: boolean; status: ProviderAuthStatus }> {
  try {
    const response = await api.providers.authStatus(provider);

    if (!response.ok) {
      return {
        answered: false,
        status: { authenticated: false, email: null, method: null, loading: false, error: FALLBACK_STATUS_ERROR },
      };
    }

    const payload = (await response.json()) as ProviderAuthStatusApiResponse;
    return { answered: true, status: toProviderAuthStatus(payload.data) };
  } catch (caughtError) {
    console.error(`Error checking ${provider} auth status:`, caughtError);
    return {
      answered: false,
      status: { authenticated: false, email: null, method: null, loading: false, error: toErrorMessage(caughtError) },
    };
  }
}

type UseProviderAuthStatusOptions = {
  initialLoading?: boolean;
};

export function useProviderAuthStatus(
  { initialLoading = true }: UseProviderAuthStatusOptions = {},
) {
  const [providerAuthStatus, setProviderAuthStatus] = useState<ProviderAuthStatusMap>(() => (
    createInitialProviderAuthStatusMap(initialLoading)
  ));

  const setProviderLoading = useCallback((provider: LLMProvider) => {
    setProviderAuthStatus((previous) => ({
      ...previous,
      [provider]: {
        ...previous[provider],
        loading: true,
        error: null,
      },
    }));
  }, []);

  const setProviderStatus = useCallback((provider: LLMProvider, status: ProviderAuthStatus) => {
    setProviderAuthStatus((previous) => ({
      ...previous,
      [provider]: status,
    }));
  }, []);

  const checkProviderAuthStatus = useCallback(async (provider: LLMProvider): Promise<ProviderAuthStatus> => {
    setProviderLoading(provider);
    const { status } = await fetchProviderAuthStatus(provider);
    setProviderStatus(provider, status);
    return status;
  }, [setProviderLoading, setProviderStatus]);

  const refreshProviderAuthStatuses = useCallback(async (providers: LLMProvider[] = CLI_PROVIDERS) => {
    await Promise.all(providers.map((provider) => checkProviderAuthStatus(provider)));
  }, [checkProviderAuthStatus]);

  return {
    providerAuthStatus,
    checkProviderAuthStatus,
    refreshProviderAuthStatuses,
  };
}
