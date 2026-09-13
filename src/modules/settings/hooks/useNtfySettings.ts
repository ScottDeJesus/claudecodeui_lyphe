import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson } from '@/shared/api';
import type { NtfySettingsInput, NtfySettingsView } from '@/shared/types';

/**
 * The card's editable copy of the settings.
 *
 * `topic` and `token` start blank on purpose: the server answers with a mask and a boolean,
 * never with the credentials, so there is nothing truthful to prefill them with. A blank one
 * at save time therefore means "the user did not touch this", not "clear it".
 */
type NtfyDraft = {
  serverUrl: string;
  topic: string;
  token: string;
  longRunMinutes: number;
  enabled: boolean;
  appUrl: string;
};

/** What the card prints under its buttons, and what its controls disable themselves on. */
type NtfyStatus = {
  kind: 'idle' | 'saving' | 'saved' | 'testing' | 'tested' | 'error';
  message: string | null;
};

/**
 * What the fields held the moment the view loaded — the yardstick `save` measures against.
 *
 * `appUrl` is deliberately blank rather than prefilled here: the draft below DOES prefill it,
 * so an instance with no URL stored sees the prefilled origin as a change and actually saves
 * it. Skipping it as "unchanged" would leave every tap-through link with nowhere to open.
 */
function baselineFromView(view: NtfySettingsView | null): NtfyDraft {
  return {
    serverUrl: view?.serverUrl ?? '',
    topic: '',
    token: '',
    longRunMinutes: view?.longRunMinutes ?? 0,
    enabled: Boolean(view?.enabled),
    appUrl: view?.appUrl ?? '',
  };
}

/** The same values as the fields first show them. */
function draftFromView(view: NtfySettingsView | null): NtfyDraft {
  return {
    ...baselineFromView(view),
    // The address this page was opened at is the address a phone would have to reach, so it
    // is the honest suggestion — and a suggestion nobody ever saves is worth nothing.
    appUrl: view?.appUrl ?? window.location.origin,
    // A channel being set up is being set up to be used. This also matches what the server
    // assumes when a save carries no `enabled`, so the switch never lies about the outcome.
    enabled: view?.configured ? view.enabled : true,
  };
}

/**
 * Whether a URL names this machine only. The prefilled origin is one of these whenever the page
 * was opened as localhost or 127.0.0.1, and saving it as the instance-wide tap-through URL would
 * point every push at an address no phone can reach — so an unedited one is never sent.
 */
function isLoopbackUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return hostname === 'localhost' || hostname === '[::1]' || /^127\./.test(hostname);
  } catch {
    return false;
  }
}

/** The sentence a failed call puts under the buttons. The ntfy routes never quote a topic or a token, so their words are safe to show verbatim. */
function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/**
 * The ntfy settings card's whole behaviour: load, edit, save, test, remove.
 *
 * Used by NtfySettingsCard alone. It saves a PATCH, not the form — only the fields the user
 * actually changed are sent, because an absent field keeps its stored value and the stored
 * access token is one the card can never see, let alone re-send.
 */
export function useNtfySettings() {
  const { t } = useTranslation('settings');

  // The server's masked view of what is stored. Null until the first load answers.
  const [view, setView] = useState<NtfySettingsView | null>(null);
  // True for the first load only, so the card can hold its controls shut rather than blank.
  const [isLoading, setIsLoading] = useState(true);
  // What the fields show right now.
  const [draft, setDraftState] = useState<NtfyDraft>(() => draftFromView(null));
  // What they showed when the view last loaded; `save` sends only what differs from it.
  const [baseline, setBaseline] = useState<NtfyDraft>(() => baselineFromView(null));
  // What the card says under its buttons.
  const [status, setStatus] = useState<NtfyStatus>({ kind: 'idle', message: null });
  // The fields the user actually typed in. A token typed and then deleted is a deliberate
  // clear, and by value alone that is indistinguishable from never having been touched.
  const touchedRef = useRef<Set<keyof NtfyDraft>>(new Set());

  /** Adopts a freshly answered view as the new truth, discarding what the form was holding. */
  const applyView = useCallback((next: NtfySettingsView) => {
    setView(next);
    setDraftState(draftFromView(next));
    setBaseline(baselineFromView(next));
    touchedRef.current = new Set();
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const loaded = await readApiJson<NtfySettingsView>(await api.notifications.ntfy.get());
        if (!cancelled) applyView(loaded);
      } catch (error) {
        if (!cancelled) setStatus({ kind: 'error', message: messageOf(error) });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyView]);

  /** Patches the draft and remembers that the user has been in these fields. */
  const setDraft = useCallback((patch: Partial<NtfyDraft>) => {
    for (const field of Object.keys(patch) as (keyof NtfyDraft)[]) {
      touchedRef.current.add(field);
    }
    setDraftState((current) => ({ ...current, ...patch }));
  }, []);

  /** Only what the user changed. An untouched token field sends nothing and keeps the stored one. */
  const changedFields = useCallback((): NtfySettingsInput => {
    const changed = (field: keyof NtfyDraft) =>
      touchedRef.current.has(field) || draft[field] !== baseline[field];

    const input: NtfySettingsInput = {};
    if (changed('serverUrl')) input.serverUrl = draft.serverUrl.trim();
    // A blank topic is never sent. Unlike the token there is no such thing as clearing it — the
    // route answers 400 — so a topic typed and then emptied means "keep the stored one".
    if (changed('topic') && draft.topic.trim()) input.topic = draft.topic.trim();
    if (changed('token')) input.token = draft.token.trim();
    if (changed('longRunMinutes')) input.longRunMinutes = draft.longRunMinutes;
    if (changed('enabled')) input.enabled = draft.enabled;
    const isUneditedLoopbackPrefill = !touchedRef.current.has('appUrl') && isLoopbackUrl(draft.appUrl);
    if (changed('appUrl') && !isUneditedLoopbackPrefill) input.appUrl = draft.appUrl.trim();
    return input;
  }, [baseline, draft]);

  const save = useCallback(async () => {
    setStatus({ kind: 'saving', message: null });
    try {
      const saved = await readApiJson<NtfySettingsView>(
        await api.notifications.ntfy.save(changedFields()),
      );
      applyView(saved);
      setStatus({ kind: 'saved', message: t('notifications.ntfy.saved') });
    } catch (error) {
      setStatus({ kind: 'error', message: messageOf(error) });
    }
  }, [applyView, changedFields, t]);

  const remove = useCallback(async () => {
    setStatus({ kind: 'saving', message: null });
    try {
      await readApiJson<{ ok: boolean }>(await api.notifications.ntfy.remove());
      // Re-read rather than assume an empty view: the tap-through URL is instance-wide and
      // survives one user forgetting their channel.
      applyView(await readApiJson<NtfySettingsView>(await api.notifications.ntfy.get()));
      setStatus({ kind: 'idle', message: null });
    } catch (error) {
      setStatus({ kind: 'error', message: messageOf(error) });
    }
  }, [applyView]);

  const sendTest = useCallback(async () => {
    setStatus({ kind: 'testing', message: null });
    try {
      // A publish that ntfy refused is an HTTP 200 carrying `ok: false` — the route reports
      // the attempt, it does not fail over it, so the answer has to be read and not just awaited.
      const result = await readApiJson<{ ok: boolean; status: number | null; error: string | null }>(
        await api.notifications.ntfy.test(),
      );
      if (result.ok) {
        setStatus({ kind: 'tested', message: t('notifications.ntfy.tested') });
        return;
      }
      const detail = result.error || (result.status ? `HTTP ${result.status}` : '');
      setStatus({
        kind: 'error',
        message: detail
          ? `${t('notifications.ntfy.testFailed')} — ${detail}`
          : t('notifications.ntfy.testFailed'),
      });
    } catch (error) {
      setStatus({ kind: 'error', message: messageOf(error) });
    }
  }, [t]);

  return { view, isLoading, draft, setDraft, save, remove, sendTest, status };
}
