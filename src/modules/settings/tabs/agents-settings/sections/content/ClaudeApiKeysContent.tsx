import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClaudeApiKeys } from '@/shared/hooks/useClaudeApiKeys';
import type { ClaudeApiCardView, ClaudeApiKeySave, Tone } from '@/shared/types';
import { Badge, Button, SettingRow } from '@/shared/ui';
import ClaudeApiKeyRow from '@/modules/settings/tabs/agents-settings/sections/content/ClaudeApiKeyRow';

/**
 * THE CLAUDE API KEYS CARD — Claude's account panel, directly after the DeepSeek row's card, in
 * `RunnerModelContent`'s frame: one header row that says WHO PAYS FOR PLAN RUNS and why, then one
 * row per key slot. Its figures are the door's picture, `claude-api status --json`, never this
 * card's arithmetic.
 *
 * WHO PAYS IS THE FIRST LINE. `rides.why` is the door's own sentence and is drawn as data, in every
 * state that can carry it — including the sentence that still holds while a key spends down, that
 * new work waits for the subscription's room until key-carry lands. The card never paraphrases it,
 * and never prefixes a payer sentence of its own: the door's sentence already opens with one.
 *
 * EVERY STATE IS A HOLE DRAWN. Asking and unreadable each keep the reader on this card with the
 * words that say which one it is and the press that asks again; unreadable is "unknown", never
 * "not set", because a key the card cannot see is not a key it may overwrite. The rows then say
 * what the picture says: set or not, spent and left, window open or opening, a wall and its lift.
 *
 * THE CARD HOLDS NO KEY. It names a key by slot and label, never by id or digest (INV-76), and the
 * password field is the only place a key is ever typed — the card's own state holds it just long
 * enough for the save body, and the read never returns it.
 *
 * THE READ IS THE HOOK'S. `useClaudeApiKeys` asks GET /api/settings/claude-api and re-asks whenever
 * the page regains focus, because a key's standing moves while Settings is closed; a save or a
 * removal answers the fresh picture. The card keeps only the drafts.
 */
export default function ClaudeApiKeysContent() {
  const { t } = useTranslation('settings');

  // The door's picture (`null` while the read is on the wire, `{unreadable:true}` when it will not
  // answer), the slot a write is in flight on, and the door's own words for a refused save.
  const view: ClaudeApiCardView = useClaudeApiKeys();
  const { picture, savingSlot, refusal } = view;

  // A key typed into a row lives here until a save answers SAVED; the row's field is controlled by the
  // card so the filled `onSave` can empty exactly the slot that saved, and nothing on a refusal.
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  // SAVED is the only answer that empties a field: a refusal keeps what was typed so the reader can
  // correct it, and a failed write keeps it too.
  const onSave = (slot: number, body: ClaudeApiKeySave): void => {
    void view.save(slot, body).then((saved) => {
      if (saved) setDrafts((current) => ({ ...current, [slot]: '' }));
    });
  };
  const onRemove = (slot: number): void => { void view.remove(slot); };
  const onRetry = (): void => { void view.refresh(); };

  const asking = picture === null;
  const unreadable = picture !== null && 'unreadable' in picture;
  const read = picture !== null && !('unreadable' in picture) ? picture : null;
  const rides = read?.rides ?? null;

  // The badge word is the payer in one or two words; the sentence under the title names it fully.
  const payerWord = asking
    ? t('agents.claudeApi.asking', { defaultValue: 'Asking…' })
    : unreadable
      ? t('agents.claudeApi.unknown', { defaultValue: 'Unknown' })
      : rides === null || rides.slot === null
        ? t('agents.claudeApi.payerWalled', { defaultValue: 'Walled' })
        : rides.slot === 0
          ? t('agents.claudeApi.payerSubscription', { defaultValue: 'Subscription' })
          : t('agents.claudeApi.payerKey', { defaultValue: 'API key {{slot}}', slot: rides.slot });
  const payerTone: Tone = asking
    ? 'neutral'
    : unreadable
      ? 'warn'
      : rides === null || rides.slot === null
        ? 'warn'
        : rides.slot === 0
          ? 'positive'
          : 'info';

  // The first line is the door's `rides.why`, alone, for every payer: it already opens with the
  // payer in the door's own words ("Plan runs ride …"), so a payer sentence of the card's own would
  // say it twice, which the live picture did (INV-8937). The badge keeps the short word.
  const description = asking
    ? t('status.loading', { ns: 'common', defaultValue: 'Loading...' })
    : unreadable
      ? t('agents.claudeApi.unreadable', {
          defaultValue: 'The door’s picture could not be read, so who pays for plan runs is unknown — this is not the same as no key set. It is retried whenever this page regains focus.',
        })
      : (
        <>
          <span className="block">
            {rides?.why
              ? rides.why
              : t('agents.claudeApi.ridesNone', {
                  defaultValue: 'No payer can carry a plan run, so plan runs try your subscription.',
                })}
          </span>
          <span className="mt-1 block">
            {t('agents.claudeApi.purpose', {
              defaultValue: 'Two Anthropic API keys, entered here, pay for plan runs when the subscription cannot — and pay first when a key’s monthly credit is about to renew away.',
            })}
          </span>
        </>
      );

  // One row per slot, in slot order, whatever order the picture carries them in. After a failed read
  // there is no picture: both rows are drawn as unknown, with no field to overwrite anything.
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      <SettingRow
        icon={<KeyRound className="h-4 w-4" />}
        label={(
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {t('agents.claudeApi.title', { defaultValue: 'Claude API keys' })}
            <Badge as="span" tone={payerTone}>{payerWord}</Badge>
          </span>
        )}
        description={description}
      >
        {asking || unreadable ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
          </Button>
        ) : null}
      </SettingRow>

      {asking ? null : [1, 2].map((slot) => {
        const key = read === null ? null : read.keys.find((candidate) => candidate.slot === slot) ?? null;
        const rowRefusal = refusal !== null && refusal.slot === slot ? refusal.words : null;
        return (
          <ClaudeApiKeyRow
            key={slot}
            slot={slot}
            picture={key}
            unknown={unreadable}
            saving={savingSlot === slot}
            blocked={savingSlot !== null}
            refusal={rowRefusal}
            draft={drafts[slot] ?? ''}
            onDraftChange={(next) => setDrafts((current) => ({ ...current, [slot]: next }))}
            onSave={onSave}
            onRemove={onRemove}
          />
        );
      })}
    </div>
  );
}
