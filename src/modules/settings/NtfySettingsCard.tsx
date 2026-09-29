import { useTranslation } from 'react-i18next';

import { useNtfySettings } from '@/modules/settings/hooks/useNtfySettings';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import { Button, Input, SettingRow } from '@/shared/ui';

/** The text inputs' width. Wider than fits beside a 10rem text column on a phone, so the row drops the field below its label there, where it still fits the row. */
const FIELD_WIDTH = 'w-64 max-w-full';

/**
 * Rendered by the settings module's notifications tab: the ntfy phone-push channel — its
 * server, topic, access token, tap-through URL, long-run threshold and on/off switch, plus
 * a test push.
 *
 * The topic and token are credentials, so this card writes them and never reads them back:
 * the topic shows as the server's mask once configured, and the token field is a blank
 * password box that means "keep what is stored" until somebody types in it.
 */
export default function NtfySettingsCard() {
  const { t } = useTranslation('settings');
  const { view, isLoading, draft, setDraft, save, remove, sendTest, status } = useNtfySettings();

  const isBusy = isLoading || status.kind === 'saving' || status.kind === 'testing';
  const isConfigured = Boolean(view?.configured);

  return (
    <div data-testid="ntfy-card">
      <SettingsSection
        title={t('notifications.ntfy.title')}
        description={t('notifications.ntfy.description')}
      >
        <SettingsCard divided>
          <SettingRow label={t('notifications.ntfy.server')}>
            <Input
              data-testid="ntfy-server"
              className={FIELD_WIDTH}
              value={draft.serverUrl}
              disabled={isLoading}
              onChange={(event) => setDraft({ serverUrl: event.target.value })}
            />
          </SettingRow>

          <SettingRow
            label={t('notifications.ntfy.topic')}
            description={
              isConfigured
                ? `${t('notifications.ntfy.configured', { topic: view?.topicMasked })} · ${t('notifications.ntfy.topicHint')}`
                : t('notifications.ntfy.topicHint')
            }
          >
            {/* `off` on the topic and `new-password` on the token below: a text box followed by a
                password box reads to a browser as a login form, and autofilling this address's
                saved CloudCLI login would type the password into the token — which a save then
                stores and sends to ntfy on every push. The same guard SetupForm uses. */}
            <Input
              data-testid="ntfy-topic"
              autoComplete="off"
              className={FIELD_WIDTH}
              value={draft.topic}
              disabled={isLoading}
              onChange={(event) => setDraft({ topic: event.target.value })}
            />
          </SettingRow>

          <SettingRow label={t('notifications.ntfy.token')}>
            <Input
              data-testid="ntfy-token"
              type="password"
              autoComplete="new-password"
              className={FIELD_WIDTH}
              value={draft.token}
              disabled={isLoading}
              placeholder={view?.hasToken ? t('notifications.ntfy.tokenKept') : undefined}
              onChange={(event) => setDraft({ token: event.target.value })}
            />
          </SettingRow>

          <SettingRow
            label={t('notifications.ntfy.appUrl')}
            description={t('notifications.ntfy.appUrlHint')}
          >
            <Input
              data-testid="ntfy-app-url"
              className={FIELD_WIDTH}
              value={draft.appUrl}
              disabled={isLoading}
              onChange={(event) => setDraft({ appUrl: event.target.value })}
            />
          </SettingRow>

          <SettingRow label={t('notifications.ntfy.longRun')}>
            <Input
              data-testid="ntfy-long-run"
              type="number"
              min="0"
              className="w-20"
              value={String(draft.longRunMinutes)}
              disabled={isLoading}
              // Parsed here rather than at save time so an emptied box reads as 0 — "notify
              // every run" — instead of reaching the route as NaN and coming back a 400.
              onChange={(event) =>
                setDraft({ longRunMinutes: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })
              }
            />
          </SettingRow>

          <SettingRow label={t('notifications.ntfy.enabled')}>
            <div data-testid="ntfy-enabled">
              <SettingsToggle
                checked={draft.enabled}
                onChange={(value) => setDraft({ enabled: value })}
                ariaLabel={t('notifications.ntfy.enabled')}
                disabled={isLoading}
              />
            </div>
          </SettingRow>

          {/* The actions carry the section's own name: SettingRow always labels its control,
              and these three act on the whole channel rather than on any one field above. */}
          <SettingRow label={t('notifications.ntfy.title')}>
            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  data-testid="ntfy-save"
                  type="button"
                  size="sm"
                  variant="tonal"
                  disabled={isBusy}
                  onClick={() => void save()}
                >
                  {t('notifications.ntfy.save')}
                </Button>
                <Button
                  data-testid="ntfy-test"
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isBusy || !isConfigured}
                  onClick={() => void sendTest()}
                >
                  {t('notifications.ntfy.test')}
                </Button>
                <Button
                  data-testid="ntfy-remove"
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isBusy || !isConfigured}
                  onClick={() => void remove()}
                >
                  {t('notifications.ntfy.remove')}
                </Button>
              </div>
              {/* Always mounted, so the line appearing is never mistaken for the card moving. */}
              <p data-testid="ntfy-status" className="min-h-4 text-right text-xs text-muted-foreground">
                {status.message}
              </p>
            </div>
          </SettingRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
