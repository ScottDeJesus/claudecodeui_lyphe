import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';

import { Badge, Button, SettingRow, SettingsCard, SettingsSection } from '@/shared/ui';
import { api, readApiJson } from '@/shared/api';
import SettingsToggle from '@/modules/settings/SettingsToggle';

type BrowserUseSettings = {
  enabled: boolean;
};

type BrowserUseStatus = {
  enabled: boolean;
  available: boolean;
  playwrightInstalled: boolean;
  chromiumInstalled: boolean;
  installInProgress: boolean;
  message: string;
};

/** Rendered by Settings for the "browser" tab, configuring the browser automation integration. */
export default function BrowserUseSettingsTab() {
  const [settings, setSettings] = useState<BrowserUseSettings | null>(null);
  const [status, setStatus] = useState<BrowserUseStatus | null>(null);
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);
  const [isStatusLoading, setIsStatusLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const settingsResponse = await api.browserUse.settings();
    const settingsData = await readApiJson<{ data: { settings: BrowserUseSettings } }>(settingsResponse);
    setSettings(settingsData.data.settings);
  }, []);

  const loadStatus = useCallback(async () => {
    const statusResponse = await api.browserUse.status();
    const statusData = await readApiJson<{ data: BrowserUseStatus }>(statusResponse);
    setStatus(statusData.data);
  }, []);

  useEffect(() => {
    setError(null);
    setIsSettingsLoading(true);
    setIsStatusLoading(true);

    void loadSettings()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load Browser settings'))
      .finally(() => setIsSettingsLoading(false));

    void loadStatus()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load Browser status'))
      .finally(() => setIsStatusLoading(false));
  }, [loadSettings, loadStatus]);

  const updateSettings = async (nextSettings: Partial<BrowserUseSettings>) => {
    setIsSaving(true);
    setError(null);
    try {
      const response = await api.browserUse.saveSettings(nextSettings);
      const data = await readApiJson<{ data: { settings: BrowserUseSettings } }>(response);
      setSettings(data.data.settings);
      // The Browser view re-reads its status on this (BrowserUsePanel): it can be mounted under this dialog.
      window.dispatchEvent(new Event('browserUseSettingsChanged'));
      setIsStatusLoading(true);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Browser settings');
    } finally {
      setIsStatusLoading(false);
      setIsSaving(false);
    }
  };

  const installBrowserBinaries = async () => {
    setIsInstalling(true);
    setError(null);
    try {
      const response = await api.browserUse.installRuntime();
      await readApiJson(response);
      setIsStatusLoading(true);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install browser runtime');
    } finally {
      setIsStatusLoading(false);
      setIsInstalling(false);
    }
  };

  const browserEnabled = settings?.enabled === true;
  const needsBrowserBinaries = Boolean(browserEnabled && status && (!status.playwrightInstalled || !status.chromiumInstalled));
  const runtimeLabel = (installed?: boolean) => {
    if (isStatusLoading && !status) {
      return 'checking...';
    }
    return installed ? 'installed' : 'missing';
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Browser"
        description="Allow agents to create guarded Playwright browser sessions that you can monitor from the Browser tab."
      >
        <SettingsCard divided>
          <SettingRow
            label="Enable Browser"
            description="Registers Browser for supported agents. Agents can create browser sessions; you can watch, stop, and delete them."
          >
            {isSettingsLoading && !settings ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <SettingsToggle
                checked={browserEnabled}
                onChange={(value) => void updateSettings({ enabled: value })}
                ariaLabel="Enable Browser"
                disabled={isSaving}
              />
            )}
          </SettingRow>

          <div className="space-y-4 px-4 py-4">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge as="span" variant="outline">
                Playwright: {runtimeLabel(status?.playwrightInstalled)}
              </Badge>
              <Badge as="span" variant="outline">
                Chromium: {runtimeLabel(status?.chromiumInstalled)}
              </Badge>
              <Badge as="span" variant="outline">
                Status: {isStatusLoading && !status ? 'checking...' : status?.available ? 'ready' : browserEnabled ? 'setup required' : 'disabled'}
              </Badge>
            </div>

            {needsBrowserBinaries && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium text-foreground">Browser runtime required</div>
                  <p className="text-sm text-muted-foreground">
                    {status?.message || 'Install the browser runtime before agents can create Browser sessions.'}
                  </p>
                </div>

                <Button
                  type="button"
                  size="sm"
                  onClick={() => void installBrowserBinaries()}
                  disabled={isInstalling || status?.installInProgress}
                  className="flex-shrink-0 finger:h-11 finger:w-11 finger:px-0"
                  aria-label={isInstalling || status?.installInProgress ? 'Installing...' : 'Install Runtime'}
                  title={isInstalling || status?.installInProgress ? 'Installing...' : 'Install Runtime'}
                >
                  {isInstalling || status?.installInProgress ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  <span className="finger:hidden">{isInstalling || status?.installInProgress ? 'Installing...' : 'Install Runtime'}</span>
                </Button>
              </div>
            )}

            {error && (
              <div className="bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger-ink)]">
                {error}
              </div>
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
