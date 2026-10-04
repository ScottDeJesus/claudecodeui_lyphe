import { LogIn, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Button, LLMProviderLogo, SettingRow } from '@/shared/ui';
import type { AgentProvider, ProviderAuthStatus } from '@/shared/types';

type AccountContentProps = {
  agent: AgentProvider;
  authStatus: ProviderAuthStatus;
  onLogin: () => void;
  /** Claude only, and optional: hands the design authorization to whoever owns the login modal. A provider that never sets it draws no such row. */
  onDesignLogin?: () => void;
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
export default function AccountContent({ agent, authStatus, onLogin, onDesignLogin }: AccountContentProps) {
  const { t } = useTranslation('settings');
  const config = agentConfig[agent];

  // The tone never speaks alone: connected carries a tick, and the two other states carry words
  // of their own — "Checking…" is not "not connected".
  const statusBadge = authStatus.loading ? (
    <Badge tone="neutral">{t('agents.authStatus.checking')}</Badge>
  ) : authStatus.authenticated ? (
    <Badge tone="positive" className="gap-1">
      <span aria-hidden="true">✓</span>
      {t('agents.authStatus.connected')}
    </Badge>
  ) : (
    <Badge tone="neutral">{t('agents.authStatus.notSignedIn')}</Badge>
  );

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

      <div className="divide-y divide-border/50 rounded-xl border border-border bg-card">
        {/* A status is not a control, so it rides the label line with `null` for the controls: in
            the controls slot the row's 10rem floor treats a badge like a button and drops it
            under the text on a 320px phone. */}
        <SettingRow
          label={(
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {t('agents.connectionStatus')}
              {statusBadge}
            </span>
          )}
          description={authStatus.loading
            ? t('agents.authStatus.checkingAuth')
            : authStatus.authenticated
              ? t('agents.authStatus.loggedInAs', {
                  email: authStatus.email || t('agents.authStatus.authenticatedUser'),
                })
              : t('agents.authStatus.notConnected')}
        >
          {null}
        </SettingRow>

        {authStatus.method !== 'api_key' && (
          <SettingRow
            label={authStatus.authenticated ? t('agents.login.reAuthenticate') : t('agents.login.title')}
            description={authStatus.authenticated
              ? t('agents.login.reAuthDescription')
              : t('agents.login.description', { agent: config.name })}
          >
            <Button
              onClick={onLogin}
              variant={authStatus.authenticated ? 'outline' : 'tonal'}
              size="sm"
            >
              <LogIn className="mr-2 h-4 w-4" />
              {authStatus.authenticated ? t('agents.login.reLoginButton') : t('agents.login.button')}
            </Button>
          </SettingRow>
        )}

        {/* Under the sign-in row, drawn only for Claude. Claude Design is a SECOND claude.ai
            grant — it authorizes reading design-system projects and changes nothing about the
            account above it — so it reads as a narrower question asked after that one rather
            than as another way to sign the same account in. The button never takes the tonal
            fill the login button does when it is the thing standing between the reader and a
            working agent: nothing here is unconfigured, so nothing here is the next step. */}
        {agent === 'claude' && onDesignLogin && (
          <SettingRow label={t('agents.designLogin.title')} description={t('agents.designLogin.description')}>
            <Button onClick={onDesignLogin} variant="outline" size="sm">
              <Palette className="mr-2 h-4 w-4" />
              {t('agents.designLogin.button')}
            </Button>
          </SettingRow>
        )}

        {authStatus.error && (
          <div className="px-4 py-4 text-sm text-red-600 dark:text-red-400">
            {t('agents.error', { error: authStatus.error })}
          </div>
        )}
      </div>
    </div>
  );
}
