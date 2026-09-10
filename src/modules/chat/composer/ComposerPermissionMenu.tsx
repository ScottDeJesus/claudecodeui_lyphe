import { memo, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { PermissionMode } from '@/shared/types';
import { Chip } from '@/shared/ui';
import { permissionMark } from '@/modules/chat/utils/permissionMarks';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

type ComposerPermissionMenuProps = {
  permissionMode: PermissionMode;
  /** Modes the active provider supports, in the order the backend reports them. */
  permissionModes: PermissionMode[];
  onSelectPermissionMode: (mode: PermissionMode) => void;
};

/**
 * Rendered by chat's ChatComposer as the popover for choosing how edits happen
 * — the one setting that decides whether a file changes without being asked.
 *
 * The chip says the mode in words AND carries its tone mark — the same mark the pill wears
 * alone below `sm`, where the words do not fit. Words first: the mark is a second channel, and
 * this width has room for both, which is also what makes this chip the legend for the narrow
 * one. An unknown mode (a provider the capability matrix grew past this build) falls back to
 * its own id, which is ugly on purpose: it is a missing translation, not a working label.
 */
function ComposerPermissionMenu({
  permissionMode,
  permissionModes,
  onSelectPermissionMode,
}: ComposerPermissionMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 22 * 16);

  if (permissionModes.length === 0) {
    return null;
  }

  const heading = t('composer.editMode.heading', { defaultValue: 'How edits happen' });
  const modeLabel = (mode: PermissionMode) => t(`composer.editMode.labels.${mode}`, { defaultValue: mode });
  const modeHelp = (mode: PermissionMode) => t(`composer.editMode.help.${mode}`, { defaultValue: '' }) || undefined;

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
        aria-label={heading}
        title={heading}
      >
        {/* Selected, always: unlike the model chip this one is a standing
            decision about what the next turn may do to the files, so Verve
            gives it the filled treatment rather than the outline. */}
        <Chip size="sm" selected>
          <span
            className="vv-chip__tone"
            data-tone={permissionMark(permissionMode).tone}
            data-filled={permissionMark(permissionMode).writesUnasked}
            aria-hidden="true"
          />
          <span className="max-w-28 truncate sm:max-w-none">{modeLabel(permissionMode)}</span>
        </Chip>
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={heading}>
          <ComposerMenuHeading>{heading}</ComposerMenuHeading>
          {permissionModes.map((mode) => (
            <ComposerMenuItem
              key={mode}
              label={modeLabel(mode)}
              description={modeHelp(mode)}
              icon={(
                <span
                  className="vv-chip__tone"
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
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}

/** Memoized: the composer re-renders on every keystroke and none of this menu's props change while typing. */
export default memo(ComposerPermissionMenu);
