import { Key } from 'lucide-react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClaudeApiKeyPicture, ClaudeApiKeySave, Tone } from '@/shared/types';
import { Badge, Button, Field, Input, SettingRow } from '@/shared/ui';
import { formatDay, standingOf } from '@/modules/settings/tabs/agents-settings/sections/content/claude-api-standing';

type ClaudeApiKeyRowProps = {
  /** 1 or 2. The card names a key by slot and label, never by id or digest. */
  slot: number;
  /** The slot as the door's picture carries it, or `null` when the picture could not be read. */
  picture: ClaudeApiKeyPicture | null;
  /** The read failed: the saved state is unknown in words, never "not set", and no field is offered. */
  unknown: boolean;
  /** A write for this slot is in flight. */
  saving: boolean;
  /** Any slot's write is in flight: this row's presses are refused, never silently dropped. */
  blocked: boolean;
  /** The door's own words for a refused save of this slot, or null. */
  refusal: string | null;
  /** What the reader has typed into this slot's key field; the key never comes back from the door. */
  draft: string;
  onDraftChange: (next: string) => void;
  onSave: (slot: number, body: ClaudeApiKeySave) => void;
  onRemove: (slot: number) => void;
};

/**
 * ONE KEY SLOT — its label, its saved state, its one standing line, and the form that sets or
 * replaces it. Drawn by `ClaudeApiKeysContent`, once per slot, in the card's own frame.
 *
 * THE FORM IS ONE SUBMIT. The key field, the name, the monthly credit and the renewal day are one
 * save: the door's `set` takes all four, and the button's word follows what the press will do —
 * `Replace` once a key is set and a new one has been typed, `Save` otherwise (including a
 * settings-only save with the field empty).
 *
 * THE KEY FIELD IS THE CARD'S, CONTROLLED BY THE CARD. It is held above this row so the filled
 * `onSave` can empty it on SAVED and on nothing else; the row never reads it back from anywhere.
 *
 * THE DOOR'S WORDS GO UNDER THE FIELD. A refused save arrives in the door's own sentence, and
 * `Field`'s error slot carries it — amber, with `role="alert"`, beside the field it is about.
 *
 * A FAILED READ DRAWS NO FORM. Unknown is a state, not an empty slot: offering fields over a
 * setting the card cannot see is how a reader overwrites a credit or a label they never meant to
 * touch. The row says unknown in words and leaves the asking to the card's own retry.
 */
export default function ClaudeApiKeyRow({
  slot,
  picture,
  unknown,
  saving,
  blocked,
  refusal,
  draft,
  onDraftChange,
  onSave,
  onRemove,
}: ClaudeApiKeyRowProps) {
  const { t } = useTranslation('settings');
  const standing = standingOf(picture, unknown, t);

  const keyId = `claude-api-key-${slot}`;
  const labelId = `claude-api-label-${slot}`;
  const creditId = `claude-api-credit-${slot}`;
  const renewsId = `claude-api-renews-${slot}`;

  const savedWord = unknown
    ? t('agents.claudeApi.unknown', { defaultValue: 'Unknown' })
    : picture?.set && picture.saved_at
      ? t('agents.claudeApi.saved', { defaultValue: 'Saved {{date}}', date: formatDay(picture.saved_at) })
      : t('agents.claudeApi.notSet', { defaultValue: 'Not set' });
  const savedTone: Tone = unknown ? 'warn' : picture?.set ? 'positive' : 'neutral';

  const named = picture?.set && picture.label
    ? t('agents.claudeApi.slotLabelled', { defaultValue: 'API key {{slot}} · {{label}}', slot, label: picture.label })
    : t('agents.claudeApi.slot', { defaultValue: 'API key {{slot}}', slot });

  const typed = draft.trim().length > 0;
  const submitWord = saving
    ? t('agents.claudeApi.saving', { defaultValue: 'Saving…' })
    : picture?.set && typed
      ? t('agents.claudeApi.replace', { defaultValue: 'Replace' })
      : t('agents.claudeApi.save', { defaultValue: 'Save' });

  // The body a save sends: only the fields the form holds, and `renewsDay: null` is a deliberate
  // clearing. The key travels only when the reader typed one, and it travels in this body alone.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The buttons refuse the press while any write is out; Enter in a field still submits the form,
    // and this is the same refusal for it.
    if (blocked) return;
    const data = new FormData(event.currentTarget);
    const body: ClaudeApiKeySave = {};

    const key = draft.trim();
    if (key) body.key = key;
    const label = String(data.get('label') ?? '').trim();
    if (label) body.label = label;

    const credit = String(data.get('credit') ?? '').trim();
    if (credit !== '' && Number.isFinite(Number(credit)) && Number(credit) >= 0) body.creditUsd = Number(credit);

    const renews = String(data.get('renews') ?? '').trim();
    const renewsDay = renews === '' ? null : Number(renews);
    body.renewsDay = renewsDay !== null && Number.isFinite(renewsDay) && renewsDay >= 1 && renewsDay <= 31
      ? renewsDay
      : null;

    onSave(slot, body);
  };

  return (
    <SettingRow
      icon={<Key className="h-4 w-4" />}
      label={(
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {named}
          <Badge as="span" tone={savedTone}>{savedWord}</Badge>
        </span>
      )}
      description={(
        <span className="block">
          {standing.base !== null && (
            <>
              {standing.base}
              {/* A REAL space between the base and the clause, in both branches: the dot's margin is
                  paint, and without a whitespace node the text layer reads `$200.00out of credit`
                  while the dot is aria-hidden and cannot separate it for assistive tech. One mark
                  still separates: the toned clause carries its dot, the neutral one its interpunct. */}
              {' '}
              {standing.tone === 'neutral' && <span aria-hidden="true">· </span>}
            </>
          )}
          <span data-tone={standing.tone} className="font-medium text-tone-ink">
            {/* The dot is INLINE with the words, not a flex item beside them: as a flex item it takes
                a line of its own when the clause wraps on a 320px row, and a tone dot alone is a state
                no one can read. Neutral draws none: "window opens" is not a signal, and a grey dot
                beside the interpunct is noise where the reader needs a date. */}
            {standing.tone !== 'neutral' && (
              <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-tone-dot align-middle" />
            )}
            {standing.clause}
          </span>
        </span>
      )}
    >
      {unknown ? null : (
        // A save stamps `saved_at`, and a removal clears it: the form is remounted on either, so a
        // slot that just changed hands does not keep the old slot's settings in its fields.
        <form
          key={picture?.saved_at ?? 'unset'}
          className="flex w-72 max-w-full flex-col gap-3"
          onSubmit={submit}
        >
          <Field
            label={t('agents.claudeApi.keyField', { defaultValue: 'API key' })}
            htmlFor={keyId}
            helper={refusal === null
              ? t('agents.claudeApi.keyHelper', { defaultValue: 'Starts with sk-ant-api. It is sent once and never shown again.' })
              : undefined}
            error={refusal ?? undefined}
          >
            <Input
              id={keyId}
              name="key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={refusal === null ? `${keyId}-helper` : undefined}
              value={draft}
              invalid={refusal !== null}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={t('agents.claudeApi.keyPlaceholder', { defaultValue: 'sk-ant-api…' })}
            />
          </Field>

          <Field
            label={t('agents.claudeApi.labelField', { defaultValue: 'Name' })}
            htmlFor={labelId}
            helper={t('agents.claudeApi.labelHelper', { defaultValue: 'What you call this key; shown only here.' })}
          >
            <Input
              id={labelId}
              name="label"
              type="text"
              autoComplete="off"
              aria-describedby={`${labelId}-helper`}
              defaultValue={picture?.label ?? ''}
              placeholder={t('agents.claudeApi.labelPlaceholder', { defaultValue: 'Personal' })}
            />
          </Field>

          <div className="flex flex-wrap gap-3">
            <div className="min-w-28 flex-1">
              <Field
                label={t('agents.claudeApi.creditField', { defaultValue: 'Monthly credit (USD)' })}
                htmlFor={creditId}
              >
                {/* `step="any"`, not a whole-number step: the door types `credit_usd` as a float and
                    validates only `>= 0`, so a stored credit of 150.5 would make the browser refuse the
                    row's save on a field the reader never touched. */}
                <Input
                  id={creditId}
                  name="credit"
                  type="number"
                  min={0}
                  step="any"
                  defaultValue={picture?.credit_usd ?? 200}
                />
              </Field>
            </div>
            <div className="min-w-28 flex-1">
              <Field
                label={t('agents.claudeApi.renewsField', { defaultValue: 'Renews on day' })}
                htmlFor={renewsId}
                helper={t('agents.claudeApi.renewsHelper', { defaultValue: 'The day this account’s API credit renews.' })}
              >
                <Input
                  id={renewsId}
                  name="renews"
                  type="number"
                  min={1}
                  max={31}
                  step={1}
                  aria-describedby={`${renewsId}-helper`}
                  defaultValue={picture?.renews_day ?? ''}
                  placeholder={t('agents.claudeApi.renewsPlaceholder', { defaultValue: '1–31' })}
                />
              </Field>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant={picture?.set ? 'outline' : 'tonal'} busy={saving} aria-disabled={blocked || undefined}>
              {submitWord}
            </Button>
            {picture?.set && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                // Verve's ink pairing: `text-destructive` is `--danger` in both modes and lands at
                // 2.88:1 on the dark card; `data-tone` swaps in `--danger-ink` there (6.83:1), and
                // the light rendering is unchanged.
                data-tone="danger"
                className="text-tone-ink"
                busy={saving}
                aria-disabled={blocked || undefined}
                onClick={() => onRemove(slot)}
              >
                {t('agents.claudeApi.remove', { defaultValue: 'Remove' })}
              </Button>
            )}
          </div>
        </form>
      )}
    </SettingRow>
  );
}
