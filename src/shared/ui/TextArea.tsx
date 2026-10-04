import * as React from 'react';

import { cn } from '@/shared/utils';

type TextAreaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  /** The text. TextArea is controlled: a form that wants a draft owns it. */
  value: string;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  /** Visible lines before the reader drags it taller. */
  rows?: number;
  /** The value is rejected. Paints the amber border; the sentence belongs to the Field around it. */
  invalid?: boolean;
};

/**
 * The application-wide multi-line field, ported from Verve's own `TextArea`
 * (`_ds_bundle.js`, components/forms/TextArea.jsx): a value, its onChange, a row count, a
 * placeholder, `invalid`, and whatever else a `<textarea>` takes. Consumer: the roadmap's item
 * dialog, which asks for a goal.
 *
 * Paint is two classes. `vv-input` is `Input`'s own field paint — border, ground, focus ring and
 * the amber `vv-input--invalid` — so a title field and a goal field stacked in one dialog can never
 * drift apart. `vv-textarea` (verve/panels.css) adds only what a textarea has and an input does
 * not: line height, a vertical-only handle and a floor, plus `Input`'s colours and ground said
 * back where src/index.css pins every bare `textarea`. The padding and type size stay here, the
 * app's own scale, at `Input`'s 14px: Verve's 15px would put two sizes of text in one form. `text-sm`
 * brings a line height of its own, which `vv-textarea`'s outranks on specificity.
 * `invalid` is never the only signal — Field draws the ▲ and the message.
 */
export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ className, rows = 3, invalid = false, ...props }, ref) => {
    return (
      <textarea
        rows={rows}
        aria-invalid={invalid || undefined}
        className={cn('vv-input vv-textarea block w-full px-3 py-2 text-sm', invalid && 'vv-input--invalid', className)}
        ref={ref}
        {...props}
      />
    );
  }
);

TextArea.displayName = 'TextArea';
