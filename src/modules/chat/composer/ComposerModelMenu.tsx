import { memo, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { ProviderModelOption } from '@/shared/types';
import { DEFAULT_EFFORT_VALUE } from '@/shared/constants';
import { Chip } from '@/shared/ui';
import { resolveModelLabel } from '@/modules/chat/utils/modelLabels';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuNote,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

type EffortOption = NonNullable<ProviderModelOption['effort']>['values'][number];

type ComposerModelMenuProps = {
  effort: string;
  /** Effort values the active provider/model actually accepts; empty hides the section. */
  effortOptions: EffortOption[];
  onSelectEffort: (effort: string) => void;
  model: string;
  /** Model catalog for the active provider; empty hides the section. */
  modelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
};

/**
 * Rendered by chat's ChatComposer as the popover for choosing the active
 * provider's model and reasoning effort for the next turn.
 *
 * Two columns, model on the LEFT and reasoning on the right, in the order the choice is
 * actually made: the model decides which efforts exist, so it cannot sensibly be the thing you
 * reach second. The model list used to sit collapsed BELOW the efforts, which put the deciding
 * choice one click away and underneath the choice that depends on it. Below `sm` the columns
 * stack in the same order, model first.
 */
function ComposerModelMenu({
  effort,
  effortOptions,
  onSelectEffort,
  model,
  modelOptions,
  onSelectModel,
  modelsLoading,
}: ComposerModelMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  // Wide enough for two columns; the anchor clamps it to the viewport, and the columns stack
  // when that clamp bites.
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 34 * 16);

  const defaultEffortLabel = t('composer.effortDefault', { defaultValue: 'Default' });
  const resolvedEffortOptions = useMemo<EffortOption[]>(
    () => (effortOptions.length > 0 ? [{ value: DEFAULT_EFFORT_VALUE }, ...effortOptions] : []),
    [effortOptions],
  );
  const effortLabel = effort === DEFAULT_EFFORT_VALUE ? defaultEffortLabel : effort;

  const selectedModelOption = useMemo(
    () => modelOptions.find((option) => option.value === model) ?? null,
    [model, modelOptions],
  );
  // A conversation resumed from disk carries the id the SDK ran
  // (`claude-haiku-4-5-…`), not the alias this catalog is keyed by, so the chip
  // resolves it the same way the transcript caption does. The id itself is the
  // last resort and only a custom model reaches it — there, the id IS the name
  // the user gave it.
  const modelLabel = selectedModelOption?.label || resolveModelLabel(modelOptions, model) || model;
  // The chip has one line beside the composer, and every model in this catalog carries the 1M
  // window — so "(1M context)" spends a third of that line distinguishing nothing. The menu
  // keeps the full label, where it still separates a `[1m]` alias from a bare one.
  const chipModelLabel = modelLabel.replace(/\s*\(1M context\)\s*$/i, '');

  const hasEffortSection = resolvedEffortOptions.length > 0;
  const hasModelSection = modelOptions.length > 0 || modelsLoading;
  if (!hasEffortSection && !hasModelSection) {
    return null;
  }

  const triggerLabel = hasModelSection ? chipModelLabel : effortLabel;
  const ariaLabel = t('composer.modelMenu', {
    defaultValue: 'Select model and reasoning effort',
  });

  return (
    <>
      {/* The Chip is the paint; this button is the menu. Chip renders a <button>
          of its own when it is given an onClick, and that one announces a pressed
          state rather than a popup — so the chip stays a static span and the
          element around it carries the trigger semantics and the anchor ref. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className="shrink-0"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <Chip size="sm">
          <span className="max-w-20 truncate sm:max-w-56">{triggerLabel}</span>
          {hasModelSection && hasEffortSection && effort !== DEFAULT_EFFORT_VALUE && (
            <span className="hidden shrink-0 capitalize sm:inline">· {effortLabel}</span>
          )}
        </Chip>
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={ariaLabel}>
          <div className="flex flex-col sm:flex-row sm:items-stretch sm:gap-1">
            {hasModelSection && (
              <div
                role="group"
                aria-label={t('composer.modelHeading', { defaultValue: 'Model for this conversation' })}
                className="min-w-0 sm:flex-1"
              >
                <ComposerMenuHeading>
                  {t('composer.modelHeading', { defaultValue: 'Model for this conversation' })}
                </ComposerMenuHeading>
                {modelOptions.length === 0 && modelsLoading && (
                  <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                    {t('composer.loadingModels', { defaultValue: 'Loading models…' })}
                  </p>
                )}
                {modelOptions.map((option) => (
                  <ComposerMenuItem
                    key={option.value}
                    label={option.label || option.value}
                    isSelected={option.value === model}
                    onSelect={() => {
                      onSelectModel(option.value);
                      setIsOpen(false);
                    }}
                  />
                ))}
                <ComposerMenuNote>
                  {t('composer.modelNote', {
                    defaultValue: 'Changing this starts the next message on the new model. Earlier messages stay as they are.',
                  })}
                </ComposerMenuNote>
              </div>
            )}

            {hasEffortSection && (
              <>
                {/* A rule between the columns side by side, and across them once stacked. */}
                {hasModelSection && (
                  <div className="my-1 h-px shrink-0 bg-border sm:my-0 sm:h-auto sm:w-px" aria-hidden />
                )}
                <div
                  role="group"
                  aria-label={t('composer.reasoning', { defaultValue: 'Reasoning' })}
                  className="min-w-0 sm:flex-1"
                >
                  <ComposerMenuHeading>
                    {t('composer.reasoning', { defaultValue: 'Reasoning' })}
                  </ComposerMenuHeading>
                  {resolvedEffortOptions.map((option) => (
                    <ComposerMenuItem
                      key={option.value}
                      label={option.value === DEFAULT_EFFORT_VALUE ? defaultEffortLabel : option.value}
                      description={option.description}
                      isSelected={option.value === effort}
                      onSelect={() => {
                        onSelectEffort(option.value);
                        setIsOpen(false);
                      }}
                      className="capitalize"
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}

/** Memoized: the composer re-renders on every keystroke and none of this menu's props change while typing. */
export default memo(ComposerModelMenu);
