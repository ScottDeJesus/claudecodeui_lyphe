import { memo, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import type { PermissionMode, ProviderModelOption } from '@/shared/types';
import { DEFAULT_EFFORT_VALUE } from '@/shared/constants';
import { Chip } from '@/shared/ui';
import { resolveModelLabel } from '@/modules/chat/utils/modelLabels';
import { permissionMark } from '@/modules/chat/utils/permissionMarks';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuNote,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';
import { ComposerToolsetSection } from '@/modules/chat/composer/ComposerToolsetSection';
import type { SessionToolsetsState } from '@/modules/chat/hooks/useSessionToolsets';

type EffortOption = NonNullable<ProviderModelOption['effort']>['values'][number];

type ComposerModelMenuProps = {
  effort: string;
  /** Effort values the active provider/model actually accepts; empty hides the section. */
  effortOptions: EffortOption[];
  onSelectEffort: (effort: string) => void;
  model: string;
  /** Model catalog for the active provider; empty hides the section. */
  modelOptions: ProviderModelOption[];
  /** The picker's name for each model id the provider's catalog lists (`LABELS_BY_MODEL_ID`), for a stored id on the chip. */
  modelLabelsById?: Record<string, string>;
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
  /**
   * The edit-mode choice, folded in — passed ONLY where the composer row cannot hold a second
   * chip. Absent, this menu is the model menu it has always been and the permission chip
   * stands beside it.
   */
  permissionMode?: PermissionMode;
  permissionModes?: PermissionMode[];
  onSelectPermissionMode?: (mode: PermissionMode) => void;
  /** The open chat's tool sets; with no view read, no section and no count. Compared by identity (`memo`), so it must hold still between reads. */
  toolsets?: SessionToolsetsState;
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
 *
 * Below `sm` it also absorbs the edit-mode choice, which is its own chip at every wider width.
 * Measured at 390px the two chips plus their gap took ~198px of a row that also has to hold
 * the scheduler, the send button and four icon buttons — one pill saying both is the only way
 * both fit. Nothing merges on desktop: two decisions get two chips wherever there is room.
 * Given `toolsets`, the last group is the chat's tool sets (ComposerToolsetSection), under a rule and
 * across both columns, and the pill counts the sets that are on wherever the composer's row has room.
 */
function ComposerModelMenu({
  effort,
  effortOptions,
  onSelectEffort,
  model,
  modelOptions,
  modelLabelsById,
  onSelectModel,
  modelsLoading,
  permissionMode,
  permissionModes,
  onSelectPermissionMode,
  toolsets,
}: ComposerModelMenuProps) {
  const { t } = useTranslation('chat');
  // The menu is portalled into the window the composer is drawn in, not the opener's body.
  const hostWindow = useHostWindow();
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
  const modelLabel = selectedModelOption?.label || resolveModelLabel(modelOptions, model, modelLabelsById) || model;

  const hasEffortSection = resolvedEffortOptions.length > 0;
  const hasModelSection = modelOptions.length > 0 || modelsLoading;
  const hasPermissionSection = Boolean(
    permissionMode && permissionModes && permissionModes.length > 0 && onSelectPermissionMode,
  );
  if (!hasEffortSection && !hasModelSection && !hasPermissionSection) {
    return null;
  }

  const permissionHeading = t('composer.editMode.heading', { defaultValue: 'How edits happen' });
  const permissionLabel = (mode: PermissionMode) => t(`composer.editMode.labels.${mode}`, { defaultValue: mode });
  const permissionHelp = (mode: PermissionMode) => t(`composer.editMode.help.${mode}`, { defaultValue: '' }) || undefined;

  // The pill counts what the tool-set section ticks: the sets on, and the strays the chat still holds.
  // A chat on a Cerberus node draws no rows and launches with no set, so it counts none.
  const toolsetView = toolsets?.view ?? null;
  const toolsetsOn = toolsetView && toolsetView.availability !== 'node'
    ? toolsetView.sets.filter((set) => set.on).length + toolsetView.strays.length
    : 0;

  const triggerLabel = hasModelSection ? modelLabel : effortLabel;
  // The mark on the pill is colour and fill; the words it replaced live on here, so the
  // current mode is still readable by anyone hovering, or on a screen reader. The count of sets on
  // joins them, the one way to read it where the pill has no room for it. The label keeps its
  // "Select model" start: the probe harness's MODEL_CHIP matches on it.
  const menuLabel = hasPermissionSection && permissionMode
    ? `${t('composer.setupMenu', { defaultValue: 'Select model, reasoning effort and how edits happen' })} — ${permissionLabel(permissionMode)}`
    : t('composer.modelMenu', { defaultValue: 'Select model and reasoning effort' });
  const toolsetsOnLabel = t('composer.toolsets.onLabel', { count: toolsetsOn, defaultValue_one: '{{count}} tool set on', defaultValue_other: '{{count}} tool sets on' });
  const ariaLabel = toolsetsOn > 0 ? `${menuLabel} · ${toolsetsOnLabel}` : menuLabel;

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
        {/* The folded-in edit mode is the pill's own RING rather than anything inside it.
            "Never ask" and "Ask before every edit" are the widest labels in the app and both
            truncated to an ambiguous stem on a phone; the outline says the same thing in no
            width at all, and the menu below carries the tone as a swatch beside each mode, so
            one tap is the legend. */}
        <Chip
          className="h-8"
          size="sm"
          tone={hasPermissionSection && permissionMode ? permissionMark(permissionMode).tone : undefined}
          selected={Boolean(hasPermissionSection && permissionMode && permissionMark(permissionMode).writesUnasked)}
        >
          <span className="max-w-20 truncate sm:max-w-56">{triggerLabel}</span>
          {hasModelSection && hasEffortSection && effort !== DEFAULT_EFFORT_VALUE && (
            <span className="hidden shrink-0 capitalize sm:inline">· {effortLabel}</span>
          )}
          {/* Outside `span.truncate`, which the probe harness reads the model's name from. It shows only
              while the composer's row (ChatComposer's footer, a query container) is 45rem wide. Measured,
              the row's other controls take up to ~504px from `md` up and the widest pill ~206px, so below
              that the count gives way first, before the model's name and before the send button. */}
          {toolsetsOn > 0 && (
            <span className="hidden shrink-0 [@container(min-width:45rem)]:inline" data-toolset-count>
              · {t('composer.toolsets.count', { count: toolsetsOn, defaultValue_one: '{{count}} set', defaultValue_other: '{{count}} sets' })}
            </span>
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

            {hasPermissionSection && permissionMode && permissionModes && onSelectPermissionMode && (
              <>
                {/* Only ever reached below `sm`, where the row above is already stacked — so
                    this rule is always the horizontal one. */}
                {(hasModelSection || hasEffortSection) && (
                  <div className="my-1 h-px shrink-0 bg-border" aria-hidden />
                )}
                <div role="group" aria-label={permissionHeading} className="min-w-0">
                  <ComposerMenuHeading>{permissionHeading}</ComposerMenuHeading>
                  {permissionModes.map((mode) => (
                    <ComposerMenuItem
                      key={mode}
                      label={permissionLabel(mode)}
                      description={permissionHelp(mode)}
                      icon={(
                        <span
                          className="vv-tone-dot"
                          data-tone={permissionMark(mode).tone}
                          data-filled={permissionMark(mode).writesUnasked}
                        />
                      )}
                      isSelected={mode === permissionMode}
                      onSelect={() => {
                        onSelectPermissionMode(mode);
                        setIsOpen(false);
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {toolsets?.view && (
            <>
              <ComposerMenuSeparator />
              <ComposerToolsetSection toolsets={toolsets} />
            </>
          )}
        </ComposerMenuSurface>,
        hostWindow.document.body,
      )}
    </>
  );
}

/** Memoized: the composer re-renders on every keystroke and none of this menu's props change while typing. */
export default memo(ComposerModelMenu);
