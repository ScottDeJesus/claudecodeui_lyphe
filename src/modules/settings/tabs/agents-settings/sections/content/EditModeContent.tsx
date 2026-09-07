import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { Field, Select } from '@/shared/ui';
import type { AgentProvider, PermissionMode } from '@/shared/types';

type CapabilitiesResponse = {
  success?: boolean;
  data?: {
    providers?: Array<{
      provider: AgentProvider;
      permissionModes?: string[];
      defaultPermissionMode?: string;
    }>;
  };
};

type EditModeContentProps = {
  agent: AgentProvider;
  /** The stored mode, or undefined while the user has never chosen one. */
  value: PermissionMode | undefined;
  onChange: (mode: PermissionMode) => void;
};

/**
 * Rendered by AgentCategoryContentSection for every provider's permissions
 * panel: the one place outside the chat composer where "how edits happen" can
 * be changed.
 *
 * It reads the SAME preference the composer writes
 * (`<provider>Permissions.permissionMode`), so the two surfaces cannot say
 * different things. The list of modes comes from the backend capability matrix
 * — the same `/api/providers/capabilities` the composer asks — rather than a
 * copy kept here, because a provider that grows a mode should grow it in one
 * place and appear in both.
 *
 * The strings live in the chat namespace on purpose: they are the composer's
 * vocabulary, and one wording is the whole point of this panel.
 */
export default function EditModeContent({ agent, value, onChange }: EditModeContentProps) {
  const { t } = useTranslation('chat');
  // The matrix arrives after mount and cannot be derived from anything on hand;
  // until it does there is no honest list of modes to offer.
  const [modes, setModes] = useState<PermissionMode[] | null>(null);
  // The provider's own default, shown as the effective choice when the user has
  // never picked one — so the row says what WILL happen, not a blank.
  const [defaultMode, setDefaultMode] = useState<PermissionMode | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCapabilities = async () => {
      try {
        const response = await api.providers.capabilities();
        const body = (await response.json()) as CapabilitiesResponse;
        if (cancelled || !body.success) return;

        const entry = body.data?.providers?.find((candidate) => candidate.provider === agent);
        if (!entry?.permissionModes?.length) return;

        setModes(entry.permissionModes as PermissionMode[]);
        setDefaultMode((entry.defaultPermissionMode as PermissionMode | undefined) ?? null);
      } catch (error) {
        console.error('Error loading provider capabilities:', error);
      }
    };

    void loadCapabilities();
    return () => {
      cancelled = true;
    };
  }, [agent]);

  if (!modes?.length) {
    return null;
  }

  const heading = t('composer.editMode.heading', { defaultValue: 'How edits happen' });
  const selected = (value && modes.includes(value) ? value : null)
    ?? (defaultMode && modes.includes(defaultMode) ? defaultMode : modes[0]);

  return (
    <Field
      label={heading}
      helper={t(`composer.editMode.help.${selected}`, { defaultValue: '' }) || undefined}
    >
      <Select
        ariaLabel={heading}
        value={selected}
        options={modes.map((mode) => ({
          value: mode,
          label: t(`composer.editMode.labels.${mode}`, { defaultValue: mode }),
        }))}
        onChange={(next) => onChange(next as PermissionMode)}
      />
    </Field>
  );
}
