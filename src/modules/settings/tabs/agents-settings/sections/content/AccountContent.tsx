import { LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Button, LLMProviderLogo } from '@/shared/ui';
import type { AgentProvider, ProviderAuthStatus } from '@/shared/types';

type AccountContentProps = {
  agent: AgentProvider;
  authStatus: ProviderAuthStatus;
  onLogin: () => void;
};

type AgentDisplayConfig = {
  name: string;
  description?: string;
};

/**
 * Name and blurb only. The account card used to carry a per-provider tint — a blue island for
 * Claude, purple for Cursor, zinc for OpenCode — spelled as raw Tailwind palette classes that
 * no token could reach. The prototype draws every provider row on the one surface, and the
 * provider is already named by its logo, its heading and its status badge, so the tint was
 * saying nothing the reader could not already see.
 */
const agentConfig: Record<AgentProvider, AgentDisplayConfig> = {
  claude: { name: 'Claude' },
  cursor: { name: 'Cursor' },
  codex: { name: 'Codex' },
  opencode: { name: 'OpenCode', description: 'OpenCode CLI assistant' },
};

/** Rendered by AgentCategoryContentSection for the "account" category to show sign-in state for one provider. */
export default function AccountContent({ agent, authStatus, onLogin }: AccountContentProps) {
  const { t } = useTranslation('settings');
  const config = agentConfig[agent];

  return (
    <div className="space-y-6">
      <div className="mb-4 flex items-center gap-3">
        <LLMProviderLogo provider={agent} className="h-6 w-6" />
        <div>
          <h3 className="text-lg font-medium text-foreground">{config.name}</h3>
          <p className="text-sm text-muted-foreground">
            {t(`agents.account.${agent}.description`, {
              defaultValue: config.description || `${config.name} CLI assistant`,
            })}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="font-medium text-foreground">
                {t('agents.connectionStatus')}
              </div>
              <div className="text-sm text-muted-foreground">
                {authStatus.loading ? (
                  t('agents.authStatus.checkingAuth')
                ) : authStatus.authenticated ? (
                  t('agents.authStatus.loggedInAs', {
                    email: authStatus.email || t('agents.authStatus.authenticatedUser'),
                  })
                ) : (
                  t('agents.authStatus.notConnected')
                )}
              </div>
            </div>
            <div>
              {/* The tone never speaks alone: connected carries a tick, and the two other
                  states carry words of their own — "Checking…" is not "not connected". */}
              {authStatus.loading ? (
                <Badge tone="neutral">{t('agents.authStatus.checking')}</Badge>
              ) : authStatus.authenticated ? (
                <Badge tone="positive" className="gap-1">
                  <span aria-hidden="true">✓</span>
                  {t('agents.authStatus.connected')}
                </Badge>
              ) : (
                <Badge tone="neutral">{t('agents.authStatus.notSignedIn')}</Badge>
              )}
            </div>
          </div>

          {authStatus.method !== 'api_key' && (
            <div className="border-t border-border/50 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">
                    {authStatus.authenticated ? t('agents.login.reAuthenticate') : t('agents.login.title')}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {authStatus.authenticated
                      ? t('agents.login.reAuthDescription')
                      : t('agents.login.description', { agent: config.name })}
                  </div>
                </div>
                <Button
                  onClick={onLogin}
                  variant={authStatus.authenticated ? 'outline' : 'tonal'}
                  size="sm"
                >
                  <LogIn className="mr-2 h-4 w-4" />
                  {authStatus.authenticated ? t('agents.login.reLoginButton') : t('agents.login.button')}
                </Button>
              </div>
            </div>
          )}

          {authStatus.error && (
            <div className="border-t border-border/50 pt-4">
              <div className="text-sm text-red-600 dark:text-red-400">
                {t('agents.error', { error: authStatus.error })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
