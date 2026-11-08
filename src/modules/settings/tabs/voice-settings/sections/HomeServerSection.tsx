import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { GeminiNameField } from '@/modules/settings/tabs/voice-settings/sections/GeminiNameField';
import type { HomeServerKeyStatus } from '@/shared/types';
import { Banner, Button, ConfirmDialog, Input, SettingRow, SettingsCard, SettingsSection, Spinner } from '@/shared/ui';

type HomeServerSectionProps = {
  /**
   * Whether the home server has a key, never the key itself: his own stored one (`last4` its last four characters) or none.
   * Null while the account's voice settings are still being read.
   */
  keyStatus: HomeServerKeyStatus | null;
  /** The saved address, or null when none is saved. Ignored while `keyStatus` is null. */
  address: string | null;
  /** A save of the address or the key is out: Save, Replace and Clear wait for it. */
  saving: boolean;
  /**
   * The server's sentence for the last refused save of the address or the key; while `keyStatus` is null, for the read that
   * failed. Null when none.
   */
  error: string | null;
  /** Stores this address, trimmed and well formed; null forgets it, which turns the home server off. */
  onSaveAddress: (address: string | null) => void;
  /** Stores this key as his, replacing any he stored before. */
  onSaveKey: (key: string) => void;
  /** Forgets his stored key, which turns the home server off. Called once he confirms. */
  onClearKey: () => void;
  /** Reads the settings again after a read that failed: the failed read's Banner offers it as Try again. */
  onRetry?: () => void;
};

/**
 * A key the server takes: 8-200 printable ASCII characters, no whitespace (`saveHomeServerKey`'s own rule: the key rides an HTTP
 * header).
 */
const KEY_SHAPE = /^[\x21-\x7e]{8,200}$/;
/**
 * An address the server takes, or none: an http(s) URL of at most 300 characters with no password, query or fragment
 * (`checkHomeServerAddress`'s own rule). An empty field is allowed here because emptying it forgets the saved address.
 */
const ADDRESS_SHAPE = /^(?=.{0,300}$)(?:https?:\/\/[^\s/?#@]+(?:\/[^\s?#]*)?)?$/i;

/**
 * Settings > Voice > Home server: the box that transcribes every clip first, for the chat's mic and Kaylee's talk press alike.
 * Gemini, the next card, hears a clip only when the box cannot. Composed for the settings module's VoiceSettingsTab, after the
 * vocabulary and before Gemini, from the Gemini card's own parts: its name field for the address (GeminiNameField, wide so the
 * whole address shows: saved when the field is left or on Enter, an empty field forgets the address) and the same key row (SettingRow, password Input, Save or Replace,
 * Clear and its ConfirmDialog).
 *
 * THE SECTION'S LINE says whether it is on: the box is used once it has an address AND a key, otherwise Gemini hears everything and
 * the line says what is missing. THE KEY ROW's line says whether a key is stored ("✓ Using your key ending 1a2b", green, or "▲ No
 * key: the home server is off", amber). The field empties the moment a key is sent, so a key never stands in the page after its
 * save, and is never shown back beyond the four characters the line names. A key that cannot be one (under 8 characters, or with a
 * space) says so under the field and is not sent. Clear asks first, as Settings does before it deletes any stored key.
 *
 * THE CARD'S LAST LINE says "Saving…" while a save is out and the server's refusal after one is refused. Before the settings are
 * read the card is a waiting row; a read that failed is a warn Banner with the server's sentence and Try again, and no fields: a
 * field offered over a value the page cannot see is how a good value gets overwritten.
 */
export function HomeServerSection({ keyStatus, address, saving, error, onSaveAddress, onSaveKey, onClearKey, onRetry }: HomeServerSectionProps) {
  const { t } = useTranslation('settings');
  const idBase = useId();
  // The key as he pastes it, until Save sends it. Held only here and emptied by the send: the page never holds a key after.
  const [typedKey, setTypedKey] = useState('');
  // Whether Clear's question is up: the question is the press's first half, so a key is never forgotten by one slip.
  const [confirmingClear, setConfirmingClear] = useState(false);

  const title = t('voiceSettings.homeServer.title', { defaultValue: 'Home server' });

  if (keyStatus === null) {
    return (
      <SettingsSection title={title}>
        <div data-home-server={error === null ? 'loading' : 'failed'}>
          {error === null ? (
            <SettingsCard className="flex items-center justify-center px-4 py-8">
              <Spinner size={24} label={t('voiceSettings.homeServer.loading', { defaultValue: 'Reading your home server settings…' })} />
            </SettingsCard>
          ) : (
            <Banner
              tone="warn"
              action={onRetry && (
                <Button variant="outline" size="sm" onClick={onRetry}>{t('voiceSettings.homeServer.retry', { defaultValue: 'Try again' })}</Button>
              )}
            >
              {t('voiceSettings.homeServer.loadFailed', { defaultValue: "Your home server settings couldn't be read: {{reason}}", reason: error })}
            </Banner>
          )}
        </div>
      </SettingsSection>
    );
  }

  const stored = keyStatus.source === 'stored';
  const keyInvalid = typedKey.length > 0 && !KEY_SHAPE.test(typedKey);
  const description = address !== null && stored
    ? t('voiceSettings.homeServer.on', { defaultValue: "Your home server hears every clip first, for the chat mic and Kaylee. Gemini hears it only when the home server can't." })
    : t('voiceSettings.homeServer.off', { defaultValue: 'Not set up: Gemini hears every clip. Add the address and the key to have your home server hear first.' });

  const saveKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || typedKey.length === 0 || keyInvalid) return;
    onSaveKey(typedKey);
    setTypedKey('');
  };

  const forgetKey = () => {
    setConfirmingClear(false);
    onClearKey();
  };

  const keyLine = stored
    ? { tone: 'positive', glyph: '✓', words: t('voiceSettings.homeServer.keyStored', { defaultValue: 'Using your key ending {{last4}}', last4: keyStatus.last4 ?? '' }) }
    : { tone: 'warn', glyph: '▲', words: t('voiceSettings.homeServer.keyNone', { defaultValue: 'No key: the home server is off' }) };

  return (
    <SettingsSection title={title} description={description}>
      <div data-home-server="ready">
        <SettingsCard divided>
          <GeminiNameField
            label={t('voiceSettings.homeServer.address', { defaultValue: 'Address' })}
            help={t('voiceSettings.homeServer.addressHelp', { defaultValue: 'Where the box listens, up to its /v1. Empty turns the home server off.' })}
            invalid={t('voiceSettings.homeServer.addressInvalid', { defaultValue: 'An address starts with http:// or https://, with no password, query or # in it.' })}
            stored={address ?? ''}
            placeholder="https://your-box.example.ts.net:8095/v1"
            shape={ADDRESS_SHAPE}
            hook="home-address"
            saving={saving}
            onSave={(value) => onSaveAddress(value === '' ? null : value)}
            wide
          />
          <div>
            <SettingRow
              label={t('voiceSettings.homeServer.key', { defaultValue: 'API key' })}
              description={(
                <span id={`${idBase}-key-status`} data-tone={keyLine.tone} data-home-server-key={keyStatus.source} className="font-medium text-tone-ink">
                  <span aria-hidden="true">{keyLine.glyph} </span>
                  {keyLine.words}
                </span>
              )}
              className="pb-3"
            >
              {null}
            </SettingRow>
            <form onSubmit={saveKey} className="flex flex-wrap items-center gap-2 px-4 pb-4">
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={typedKey}
                placeholder={stored
                  ? t('voiceSettings.homeServer.keyReplacePlaceholder', { defaultValue: 'Paste a new key to replace it' })
                  : t('voiceSettings.homeServer.keyPlaceholder', { defaultValue: 'Paste the home server key' })}
                aria-label={t('voiceSettings.homeServer.keyField', { defaultValue: 'Home server API key' })}
                aria-describedby={keyInvalid ? `${idBase}-key-invalid` : `${idBase}-key-status`}
                invalid={keyInvalid}
                data-home-server-key-field=""
                onChange={(event) => setTypedKey(event.target.value)}
                className="min-w-0 flex-1 basis-48"
              />
              {/* One group, so a narrow card puts both buttons under the field together instead of stranding Clear. */}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" busy={saving} disabled={typedKey.length === 0 || keyInvalid}>
                  {stored
                    ? t('voiceSettings.homeServer.replace', { defaultValue: 'Replace' })
                    : t('voiceSettings.homeServer.save', { defaultValue: 'Save' })}
                </Button>
                {stored && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    busy={saving}
                    aria-label={t('voiceSettings.homeServer.clearLabel', { defaultValue: 'Clear your home server key' })}
                    onClick={() => setConfirmingClear(true)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {t('voiceSettings.homeServer.clear', { defaultValue: 'Clear' })}
                  </Button>
                )}
              </div>
              {keyInvalid && (
                <p id={`${idBase}-key-invalid`} role="alert" data-tone="warn" className="basis-full text-xs font-medium text-tone-ink">
                  <span aria-hidden="true">▲ </span>
                  {t('voiceSettings.homeServer.keyInvalid', { defaultValue: 'A home server key is 8–200 plain ASCII characters with no spaces.' })}
                </p>
              )}
            </form>
          </div>
        </SettingsCard>

        {/* Always mounted, so the line appearing never reads as the card moving. */}
        <p data-home-server-save={saving ? 'saving' : error !== null ? 'refused' : 'idle'} className="mt-2 min-h-4 px-1 text-xs">
          {saving && <span className="text-muted-foreground">{t('voiceSettings.homeServer.saving', { defaultValue: 'Saving…' })}</span>}
          {!saving && error !== null && (
            <span role="alert" data-tone="warn" className="font-medium text-tone-ink">
              <span aria-hidden="true">▲ </span>
              {error}
            </span>
          )}
        </p>
      </div>

      <ConfirmDialog
        // Open only while his own key is stored: a key cleared meanwhile (another page) leaves nothing to ask about.
        open={confirmingClear && stored}
        // Raised over the Settings modal, a body portal at z-9999: at the default z-50 the question would open behind it.
        wrapperClassName="z-[10000]"
        title={t('voiceSettings.homeServer.clearTitle', { defaultValue: 'Forget your home server key?' })}
        message={t('voiceSettings.homeServer.clearMessage', {
          defaultValue: "The key ending {{last4}} is removed and can't be shown again. The home server is off until you save a key, and Gemini hears every clip.",
          last4: keyStatus.last4 ?? '',
        })}
        actions={[
          { label: t('voiceSettings.homeServer.cancel', { defaultValue: 'Cancel' }), variant: 'outline', onSelect: () => setConfirmingClear(false) },
          { label: t('voiceSettings.homeServer.clearConfirm', { defaultValue: 'Forget the key' }), variant: 'destructive', onSelect: forgetKey },
        ]}
        onDismiss={() => setConfirmingClear(false)}
      />
    </SettingsSection>
  );
}
