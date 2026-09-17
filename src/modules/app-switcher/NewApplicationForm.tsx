import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppEntry } from '@/shared/app-types';
import { Banner, Button, Field, Input } from '@/shared/ui';

/** What the form hands over: a name and an address the registry will accept, both already trimmed. */
type NewApplicationDraft = Pick<AppEntry, 'name' | 'url'>;

type NewApplicationFormProps = {
  /** Resolves once the row is in the registry; rejects with the sentence the reader should see. */
  onSubmit: (draft: NewApplicationDraft) => Promise<void>;
  onCancel: () => void;
};

/** The sentence under each field after this form refused to send. */
type FieldErrors = { name?: string; url?: string };

/** Any `scheme://` at the front — the reader wrote one, so it is theirs and is not second-guessed. */
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

/**
 * The address as it will be stored: trimmed, and given `http://` when the reader left the scheme off.
 * HTTP and not HTTPS, because what this registry holds is the operator's own apps on loopback, the LAN
 * and Tailscale — every seeded row is `http://{host}:<port>` — and a guessed `https://` there is an
 * address that never answers.
 */
function completeAddress(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  return HAS_SCHEME.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/**
 * The server's own test, run before the request so a typo is answered under the field instead of in a
 * banner: `{host}` stands in for `localhost`, and the result must parse as http or https
 * (`requireUrl` in server/modules/apps/apps.service.ts). The server still has the last word.
 *
 * THE HOST IS CHECKED AS WELL, because the browser's parser is looser than the server's: Chrome turns
 * `http://not an address` into host `not%20an%20address` where Node throws (measured 2026-09-16), so a
 * parse alone would pass an address the server then refuses. A real host never carries a `%`.
 */
function addressReads(address: string): boolean {
  try {
    const parsed = new URL(address.replace(/\{host\}/gi, 'localhost'));
    const webScheme = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    return webScheme && parsed.hostname.length > 0 && !parsed.hostname.includes('%');
  } catch {
    return false;
  }
}

/**
 * The inline "New application" form, in the list's place while it is open. Rendered by AppDrawer only.
 *
 * Two fields and two buttons, top to bottom in the order the reader fills them. A field that is wrong
 * says why under itself, in amber (Field's own error line), and takes the focus; a refusal from the
 * server — a duplicate, a store it could not write — is a Banner above the buttons, carrying the
 * server's own sentence, with both fields kept as typed so nothing has to be written twice.
 */
export function NewApplicationForm({ onSubmit, onCancel }: NewApplicationFormProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const nameId = useId();
  const urlId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  // What the reader has typed, kept exactly as typed: trimmed and completed only at send.
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  // The per-field sentences from the last refused send. A field's own sentence clears as it is edited,
  // so a corrected field stops accusing the reader while the other one still can.
  const [errors, setErrors] = useState<FieldErrors>({});
  // The server's refusal of the last send, or null. Cleared by the next send.
  const [refusal, setRefusal] = useState<string | null>(null);
  // True while the request is out: the send button disables so a double press cannot append twice.
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;

    const draft: NewApplicationDraft = { name: name.trim(), url: completeAddress(url) };
    const next: FieldErrors = {};
    if (draft.name.length === 0) next.name = t('applications.form.nameRequired');
    if (draft.url.length === 0) next.url = t('applications.form.urlRequired');
    else if (!addressReads(draft.url)) next.url = t('applications.form.urlInvalid');

    setErrors(next);
    setRefusal(null);
    // The first wrong field takes the focus, so the reader lands on the sentence that explains it.
    if (next.name || next.url) {
      (next.name ? nameRef : urlRef).current?.focus();
      return;
    }

    setSending(true);
    try {
      // On success the drawer closes this form, so nothing here runs after it resolves.
      await onSubmit(draft);
    } catch (failure) {
      setRefusal(failure instanceof Error ? failure.message : String(failure));
      setSending(false);
    }
  }

  function handleNameChange(value: string) {
    setName(value);
    if (errors.name) setErrors((current) => ({ ...current, name: undefined }));
  }

  function handleUrlChange(value: string) {
    setUrl(value);
    if (errors.url) setErrors((current) => ({ ...current, url: undefined }));
  }

  return (
    <form
      noValidate
      aria-labelledby={titleId}
      onSubmit={handleSubmit}
      className="flex animate-shape-rise flex-col gap-4 pb-[22px] pt-0.5 motion-reduce:animate-none"
    >
      <p id={titleId} className="text-xs uppercase tracking-[0.14em] text-ink-faint">
        {t('applications.form.title')}
      </p>

      <Field label={t('applications.form.nameLabel')} htmlFor={nameId} helper={t('applications.form.nameHelper')} error={errors.name}>
        <Input
          ref={nameRef}
          id={nameId}
          value={name}
          onChange={(event) => handleNameChange(event.target.value)}
          placeholder={t('applications.form.namePlaceholder')}
          invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? undefined : `${nameId}-helper`}
          autoComplete="off"
          autoFocus
          className="h-11 text-[15px]"
        />
      </Field>

      <Field label={t('applications.form.urlLabel')} htmlFor={urlId} helper={t('applications.form.urlHelper')} error={errors.url}>
        <Input
          ref={urlRef}
          id={urlId}
          value={url}
          onChange={(event) => handleUrlChange(event.target.value)}
          placeholder={t('applications.form.urlPlaceholder')}
          invalid={Boolean(errors.url)}
          aria-describedby={errors.url ? undefined : `${urlId}-helper`}
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-11 text-[15px]"
        />
      </Field>

      {/* Warn, not danger: nothing was lost, and both fields are still as the reader left them. */}
      {refusal !== null && (
        <Banner tone="warn">
          <p className="text-sm font-medium">{t('applications.form.addFailed')}</p>
          <p className="mt-0.5 break-words text-xs opacity-80">{refusal}</p>
        </Banner>
      )}

      <div className="mt-0.5 flex gap-2.5">
        <Button type="submit" className="h-11" disabled={sending} aria-busy={sending}>
          {t('applications.form.submit')}
        </Button>
        <Button type="button" variant="outline" className="h-11" onClick={onCancel}>
          {t('applications.form.cancel')}
        </Button>
      </div>
    </form>
  );
}
