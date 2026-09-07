import * as React from 'react';

import { cn } from '@/shared/utils';

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /** The value is rejected. Paints the amber border; the sentence belongs to the Field around it. */
  invalid?: boolean;
};

/**
 * The application-wide text input, used by the chat, file-tree, mcp, project-creation-wizard,
 * settings, sidebar and skills modules.
 *
 * Paint is `.vv-input` in verve/controls.css. The sizing utilities stay because they are the
 * app's own scale — Verve's padding would resize every input in the app. `invalid` is amber,
 * never red (doctrine §5), and never the only signal: Field draws the ▲ and the message.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, invalid = false, ...props }, ref) => {
    return (
      <input
        type={type}
        aria-invalid={invalid || undefined}
        className={cn('vv-input flex h-9 w-full px-3 py-1 text-sm', invalid && 'vv-input--invalid', className)}
        ref={ref}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';

