import React from 'react';

import { Input } from '@/shared/ui';

type QuestionTextFieldProps = {
  value: string;
  onChange: (value: string) => void;
  /** Enter inside the field — the panel advances to the next question, or submits on the last. */
  onEnter: () => void;
  placeholder: string;
};

/**
 * The typed half of an answer on the question card: the "Other" option's own words. Indented under
 * the row that opened it, with the Enter keycap inside its right edge. Used by chat's
 * AskUserQuestionPanel.
 *
 * Every key typed here is the field's: the card's own digits and Enter must not fire on a letter of
 * the sentence, so each keydown stops at the field, and Enter is handed to `onEnter` instead.
 */
export const QuestionTextField = React.forwardRef<HTMLInputElement, QuestionTextFieldProps>(
  ({ value, onChange, onEnter, placeholder }, ref) => (
    <div className="relative pl-9">
      <Input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter();
          }
          e.stopPropagation();
        }}
        placeholder={placeholder}
        // pr-16 reserves the keycap's width on the right, so typed text never runs under the
        // "Enter" hint that sits inside the field.
        className="h-9 pr-16"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
        Enter
      </kbd>
    </div>
  ),
);
QuestionTextField.displayName = 'QuestionTextField';
