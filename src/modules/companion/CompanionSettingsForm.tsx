import type { TFunction } from 'i18next';
import { RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/shared/api';
import type { CompanionSettings } from '@/shared/companion-types';
import { SETTINGS_FIELD_WIDTH } from '@/shared/constants';
import { Button, ConfirmDialog, Input, SettingRow, SettingsCard, TextArea } from '@/shared/ui';

/** The four words he sets here; the model and Live live on her panel. */
type FieldName = 'name' | 'operatorName' | 'register' | 'deliveryNote';

/** A save's settlement, said on the card's last line: nothing yet, out, done, or refused in the server's words. */
type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'refused'; reason: string | null };

type CompanionSettingsFormProps = {
  settings: CompanionSettings;
  /** Saves a partial and resolves once the server holds it; `register: null` restores the original register. */
  onSave: (patch: Partial<CompanionSettings> | { register: null }) => Promise<void>;
};

/** Each field's length bounds, the server's own (`saveCompanionSettings`), counted on the trimmed words. */
const LIMITS: Record<FieldName, { min: number; max: number }> = {
  name: { min: 1, max: 40 },
  operatorName: { min: 1, max: 40 },
  register: { min: 200, max: 16000 },
  deliveryNote: { min: 0, max: 120 },
};

const FIELDS: readonly FieldName[] = ['name', 'operatorName', 'register', 'deliveryNote'];

/** The words a field is saved as: trimmed, since a stray space at either end is never what he meant. */
const savedForm = (value: string): string => value.trim();

/** Why a field's words cannot be saved, in a sentence naming its limit; null when they can. */
function invalidWords(field: FieldName, value: string, t: TFunction): string | null {
  const count = savedForm(value).length;
  const { min, max } = LIMITS[field];
  return count < min || count > max ? t(`voiceSettings.companion.${field}Invalid`, { count, min, max }) : null;
}

/**
 * The four fields of her Settings section: her name, his name, the register and the delivery note. Drawn by this module's
 * CompanionSettingsView once her settings are read.
 *
 * SAVED AS HE GOES, as everything in Settings is ("Saved as you change them"): a field is saved when it loses focus (an
 * input also on Enter), alone, as a partial — and only when its words changed and fit. A field that does not fit says
 * why in place of its helper, amber with the ▲, and is not sent. The card's last line says "Saving…", "Saved" or the
 * server's refusal.
 *
 * THE FIELDS FOLLOW THE SERVER, field by field: when her settings change (his own save coming back, another page's), a
 * field he has not touched takes the new words, and a field he is editing keeps his.
 *
 * THE REGISTER is tall and monospace, because it is a template with `{name}`, `{delivery_note}` and `{sound_tags}` in it,
 * and its row carries "Restore the original", which asks first: his edits to it are replaced by the design's register.
 * THE DELIVERY NOTE takes the card's width under its row, as the register does: up to 120 characters do not fit the
 * names' field, and a note read through a slot is a note he cannot check.
 */
export function CompanionSettingsForm({ settings, onSave }: CompanionSettingsFormProps) {
  const { t } = useTranslation('settings');
  const idBase = useId();
  // What each field holds now: his words, which are saved as he leaves the field.
  const [values, setValues] = useState<Record<FieldName, string>>(() => pick(settings));
  // The settings the fields last agreed with: a field still holding these words follows the server when it changes.
  const [seen, setSeen] = useState(settings);
  // The last save's settlement, for the card's last line.
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  // Whether Restore's question is up.
  const [confirmingRestore, setConfirmingRestore] = useState(false);

  // Her settings changed: an untouched field takes the new words; an edited one keeps his. Set while rendering, which
  // React re-runs at once, so a stale field is never drawn.
  if (settings !== seen) {
    setSeen(settings);
    setValues((now) => {
      const next = { ...now };
      for (const field of FIELDS) if (now[field] === seen[field]) next[field] = settings[field];
      return next;
    });
  }

  const settle = (out: Promise<void>) => {
    setSave({ kind: 'saving' });
    out.then(() => setSave({ kind: 'saved' }), (error: unknown) => setSave({ kind: 'refused', reason: errorMessage(error) }));
  };

  const commit = (field: FieldName) => {
    const words = savedForm(values[field]);
    if (words === settings[field] || invalidWords(field, values[field], t) !== null) return;
    settle(onSave({ [field]: words }));
  };

  const restore = () => {
    setConfirmingRestore(false);
    // His unsaved edits to the register go with the restore: the field returns to what it last agreed with, so it
    // takes the original when it comes back.
    setValues((now) => ({ ...now, register: seen.register }));
    settle(onSave({ register: null }));
  };

  /** A row's helper, or the sentence that says why its words cannot be saved, in its place. */
  const description = (field: FieldName): ReactNode => {
    const invalid = invalidWords(field, values[field], t);
    return invalid === null ? (
      <span id={`${idBase}-${field}-help`}>{t(`voiceSettings.companion.${field}Help`)}</span>
    ) : (
      <span id={`${idBase}-${field}-help`} role="alert" data-tone="warn" className="font-medium text-tone-ink">
        <span aria-hidden="true">▲ </span>
        {invalid}
      </span>
    );
  };

  const input = (field: FieldName, width = SETTINGS_FIELD_WIDTH) => (
    <Input
      className={width}
      value={values[field]}
      aria-label={t(`voiceSettings.companion.${field}`)}
      aria-describedby={`${idBase}-${field}-help`}
      invalid={invalidWords(field, values[field], t) !== null}
      data-companion-setting={field}
      onChange={(event) => setValues((now) => ({ ...now, [field]: event.target.value }))}
      onBlur={() => commit(field)}
      onKeyDown={(event) => { if (event.key === 'Enter') commit(field); }}
    />
  );

  return (
    <>
      <SettingsCard divided>
        <SettingRow label={t('voiceSettings.companion.name')} description={description('name')}>{input('name')}</SettingRow>
        <SettingRow label={t('voiceSettings.companion.operatorName')} description={description('operatorName')}>{input('operatorName')}</SettingRow>
        <div>
          <SettingRow label={t('voiceSettings.companion.register')} description={description('register')} className="pb-3">
            <Button variant="outline" size="sm" onClick={() => setConfirmingRestore(true)}>
              <RotateCcw aria-hidden="true" />
              {t('voiceSettings.companion.restore')}
            </Button>
          </SettingRow>
          <div className="px-4 pb-4">
            <TextArea
              rows={16}
              value={values.register}
              aria-label={t('voiceSettings.companion.register')}
              aria-describedby={`${idBase}-register-help`}
              invalid={invalidWords('register', values.register, t) !== null}
              spellCheck={false}
              data-companion-setting="register"
              className="font-mono text-xs leading-relaxed"
              onChange={(event) => setValues((now) => ({ ...now, register: event.target.value }))}
              onBlur={() => commit('register')}
            />
          </div>
        </div>
        <div>
          <SettingRow label={t('voiceSettings.companion.deliveryNote')} description={description('deliveryNote')} className="pb-3">{null}</SettingRow>
          <div className="px-4 pb-4">{input('deliveryNote', 'w-full')}</div>
        </div>
      </SettingsCard>

      {/* Always mounted, so the line appearing never reads as the card moving. */}
      <p data-companion-settings-save={save.kind} className="mt-2 min-h-4 px-1 text-xs">
        {save.kind === 'saving' && <span className="text-muted-foreground">{t('voiceSettings.companion.saving')}</span>}
        {save.kind === 'saved' && (
          <span data-tone="positive" className="font-medium text-tone-ink"><span aria-hidden="true">✓ </span>{t('voiceSettings.companion.saved')}</span>
        )}
        {save.kind === 'refused' && (
          <span role="alert" data-tone="warn" className="font-medium text-tone-ink">
            <span aria-hidden="true">▲ </span>
            {save.reason === null ? t('voiceSettings.companion.refusedPlain') : t('voiceSettings.companion.refused', { reason: save.reason })}
          </span>
        )}
      </p>

      <ConfirmDialog
        open={confirmingRestore}
        // Raised over the Settings modal, a body portal at z-9999: at the default z-50 the question would open behind it.
        wrapperClassName="z-[10000]"
        title={t('voiceSettings.companion.restoreTitle')}
        message={t('voiceSettings.companion.restoreMessage')}
        actions={[
          { label: t('voiceSettings.companion.cancel'), variant: 'outline', onSelect: () => setConfirmingRestore(false) },
          { label: t('voiceSettings.companion.restoreConfirm'), variant: 'destructive', onSelect: restore },
        ]}
        onDismiss={() => setConfirmingRestore(false)}
      />
    </>
  );
}

/** The four words of a settings record, as the fields hold them. */
function pick(settings: CompanionSettings): Record<FieldName, string> {
  return { name: settings.name, operatorName: settings.operatorName, register: settings.register, deliveryNote: settings.deliveryNote };
}
