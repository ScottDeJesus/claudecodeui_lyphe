import { useState } from 'react';
import type { ComponentType } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Field, Input } from '@/shared/ui';

type AuthInputFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  placeholder: string;
  isDisabled: boolean;
  type?: 'text' | 'password' | 'email';
  name?: string;
  autoComplete?: string;
  helper?: string;
  icon?: ComponentType<{ className?: string }>;
};

/**
 * A labelled input field for authentication forms.
 * Used by the auth module's LoginForm and SetupForm for their credential inputs.
 *
 * The label/control/message stack is the library `Field` and the control is the library
 * `Input`; what stays here is the part neither of them owns — the leading icon and the
 * show/hide toggle a password field needs. The `id` and the autofill hints (`name`,
 * `autoComplete`) are forwarded untouched: a password manager finds this field by them.
 */
export default function AuthInputField({
  id,
  label,
  value,
  onChange,
  placeholder,
  isDisabled,
  type = 'text',
  name,
  autoComplete,
  helper,
  icon: Icon,
}: AuthInputFieldProps) {
  // Whether the password is currently shown as plain text. Local to this field on purpose:
  // revealing one password must not reveal the confirmation field beside it.
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const isPasswordField = type === 'password';
  const resolvedType = isPasswordField && isPasswordVisible ? 'text' : type;

  return (
    <Field label={label} htmlFor={id} helper={helper}>
      <div className="group relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
        )}
        <Input
          id={id}
          type={resolvedType}
          name={name ?? id}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          // The id Field gives the helper span. Both sides derive it from the same `id`, so a
          // field with guidance announces that guidance instead of leaving it visible-only.
          aria-describedby={helper ? `${id}-helper` : undefined}
          className={`h-11 ${Icon ? 'pl-10' : 'pl-3.5'} ${isPasswordField ? 'pr-11' : 'pr-3.5'}`}
          placeholder={placeholder}
          required
          disabled={isDisabled}
        />
        {isPasswordField && (
          <button
            type="button"
            onClick={() => setIsPasswordVisible((previous) => !previous)}
            disabled={isDisabled}
            aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            {isPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </Field>
  );
}
