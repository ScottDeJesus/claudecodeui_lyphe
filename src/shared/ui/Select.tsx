import { useEffect, useRef, useState } from 'react';

import { cn } from '@/shared/utils';

type SelectOption = { value: string; label: string };

type SelectProps = {
  options: SelectOption[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** The accessible name. A select whose label is a heading two rows up needs its own. */
  ariaLabel: string;
};

/**
 * A single-choice picker with a chevron trigger and an overlay list.
 * Used by settings (Phase 4) for the language, theme and provider choices and by the file
 * manager (Phase 8) for its sort order — the native `<select>` cannot be painted in Verve's
 * shape, so this is the one place the app spells a styled one.
 *
 * Dismissal is deliberately two-way: a pointer anywhere outside closes it, and Escape closes
 * it without moving the pointer at all. A panel that only closes on a click is a panel a
 * keyboard user is stuck inside — and Escape returns focus to the trigger, because the list
 * unmounts under the focused option and focus would otherwise fall to <body>, sending the
 * reader back to the top of the page. An outside pointerdown does NOT take focus: the pointer
 * has already chosen where to go.
 */
export function Select({ options, value, onChange, placeholder = 'Choose…', ariaLabel }: SelectProps) {
  // Whether the overlay list is showing. It cannot be derived: `value` is the choice already
  // made, and the list is open precisely while the reader is reconsidering it.
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const selected = options.find((option) => option.value === value);

  return (
    <div className="vv-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="vv-select__trigger flex w-full items-center justify-between gap-2.5"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span className={cn(!selected && 'vv-select__placeholder')}>{selected ? selected.label : placeholder}</span>
        <span className="vv-select__chevron inline-block" aria-hidden="true">
          ▼
        </span>
      </button>

      {open && (
        <ul className="vv-select__panel" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <li
              key={option.value}
              className="vv-select__option flex items-center justify-between gap-2"
              role="option"
              aria-selected={option.value === value}
              tabIndex={0}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
