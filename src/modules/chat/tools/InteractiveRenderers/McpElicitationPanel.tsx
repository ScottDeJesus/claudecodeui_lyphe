import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { ElicitationField, ElicitationFieldValue, ElicitationProblem, ElicitationRawValues, ElicitationRequestInput, PermissionPanelProps } from '@/shared/types';
import { Button, Card, Checkbox, Field, Input, Select, buttonVariants } from '@/shared/ui';
import { cn } from '@/shared/utils';
import {
  buildElicitationContent,
  initialElicitationValues,
  isOpenableUrl,
  problemWithAnswer,
  readElicitationFields,
} from '@/modules/chat/utils/mcpElicitationForm';

/** What a `date`, `date-time`, `email` or `uri` problem says, by format; any other format uses the generic sentence. */
const FORMAT_PROBLEM_KEYS: Record<string, { key: string; text: string }> = {
  email: { key: 'notAnEmail', text: 'Enter an email address' },
  uri: { key: 'notAUri', text: 'Enter a full address, such as https://example.com' },
  date: { key: 'notADate', text: 'Enter a date' },
  'date-time': { key: 'notADateTime', text: 'Enter a date and time' },
};

/** The sentence under a field whose answer is refused. Exhaustive over the problem codes, so a new rule cannot reach the page unworded. */
function problemSentence(t: TFunction<'chat'>, problem: ElicitationProblem): string {
  switch (problem.code) {
    case 'required':
      return t('mcpElicitation.required', { defaultValue: 'Required' });
    case 'notANumber':
      return t('mcpElicitation.notANumber', { defaultValue: 'Enter a number' });
    case 'notAnInteger':
      return t('mcpElicitation.notAnInteger', { defaultValue: 'Enter a whole number' });
    case 'tooSmall':
      return t('mcpElicitation.tooSmall', { value: problem.value, defaultValue: 'At least {{value}}' });
    case 'tooLarge':
      return t('mcpElicitation.tooLarge', { value: problem.value, defaultValue: 'At most {{value}}' });
    case 'tooShort':
      return t('mcpElicitation.tooShort', { count: problem.count, defaultValue: 'At least {{count}} characters' });
    case 'tooLong':
      return t('mcpElicitation.tooLong', { count: problem.count, defaultValue: 'At most {{count}} characters' });
    case 'tooFew':
      return t('mcpElicitation.tooFew', { count: problem.count, defaultValue: 'Pick at least {{count}}' });
    case 'tooMany':
      return t('mcpElicitation.tooMany', { count: problem.count, defaultValue: 'Pick at most {{count}}' });
    case 'badFormat': {
      // Only a format this table names: `format` is the server's text, and a plain lookup would find what every object inherits.
      const named = problem.format && Object.prototype.hasOwnProperty.call(FORMAT_PROBLEM_KEYS, problem.format)
        ? FORMAT_PROBLEM_KEYS[problem.format]
        : undefined;
      return named
        ? t(`mcpElicitation.${named.key}`, { defaultValue: named.text })
        : t('mcpElicitation.notTheFormat', { format: problem.format, defaultValue: 'Not a valid {{format}}' });
    }
    default:
      return assertNever(problem);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled elicitation problem: ${JSON.stringify(value)}`);
}

/**
 * Rendered by chat's PermissionRequestsBanner for a pending `McpElicitation` request: an MCP server asking the
 * person for input in the middle of a tool call. A form request is drawn as a form built from its schema and
 * answered with typed content; a URL request offers its link. Submit is `accept`, Decline is `decline`; the
 * backend maps a request that goes away unanswered to `cancel`.
 */
export const McpElicitationPanel: React.FC<PermissionPanelProps> = ({ request, onDecision }) => {
  const { t } = useTranslation('chat');
  const input = (request.input ?? {}) as ElicitationRequestInput;
  const isUrlMode = input.mode === 'url';
  const fields = useMemo(() => readElicitationFields(input.requestedSchema), [input.requestedSchema]);

  // The person's answers as typed, kept raw so a half-typed number is not lost to parsing; they are
  // parsed and checked against the schema on submit.
  const [values, setValues] = useState<ElicitationRawValues>(() => initialElicitationValues(fields));
  // Whether Submit was tried once: field problems stay hidden until then, so an empty form does not
  // open covered in "Required".
  const [attempted, setAttempted] = useState(false);

  // The part of the form that scrolls, so a failed Submit can bring its first problem into view.
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const setValue = useCallback((key: string, value: ElicitationRawValues[string]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
  }, []);

  const handleSubmit = useCallback((event?: React.FormEvent) => {
    event?.preventDefault();
    setAttempted(true);
    if (fields.some((field) => problemWithAnswer(field, values[field.key]) !== null)) {
      // After the render that draws the problems. The buttons stay pinned while the fields scroll, so
      // the problem may be out of sight.
      requestAnimationFrame(() => {
        const alert = scrollAreaRef.current?.querySelector('[role="alert"]');
        alert?.parentElement?.scrollIntoView?.({ block: 'nearest' });
      });
      return;
    }
    onDecision(request.requestId, { allow: true, updatedInput: { content: buildElicitationContent(fields, values) } });
  }, [fields, values, onDecision, request.requestId]);

  const handleDecline = useCallback(() => {
    onDecision(request.requestId, { allow: false });
  }, [onDecision, request.requestId]);

  const handleOpenUrl = useCallback(() => {
    onDecision(request.requestId, { allow: true, updatedInput: {} });
  }, [onDecision, request.requestId]);

  const serverLabel = input.displayName || input.serverName || 'MCP';
  const canOpenUrl = isUrlMode && isOpenableUrl(input.url);

  return (
    <div className="w-full" data-mcp-elicitation="">
      <Card className="overflow-hidden">
        <form onSubmit={handleSubmit} noValidate className="flex max-h-[70dvh] flex-col">
          {/* Only this part scrolls: a long form must not push its buttons out of reach, with the composer hidden. */}
          <div ref={scrollAreaRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            <div className="px-3 pb-2 pt-3 sm:px-4">
              <p className="text-xs uppercase tracking-[0.14em] text-ink-faint">
                {t('mcpElicitation.asks', { server: serverLabel, defaultValue: '{{server}} asks for your input' })}
              </p>
              {input.title && <p className="mt-1.5 text-[13px] font-semibold text-foreground">{input.title}</p>}
              <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-snug text-foreground">{input.message}</p>
              {input.description && <p className="mt-0.5 text-xs text-muted-foreground">{input.description}</p>}
            </div>

            {isUrlMode ? (
              <div className="px-3 pb-3 sm:px-4">
                <code className="block break-all rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{input.url}</code>
                {!canOpenUrl && (
                  <p className="mt-1 text-xs text-warn-ink">
                    {t('mcpElicitation.unsafeUrl', { defaultValue: 'Only http and https links can be opened from here.' })}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3 px-3 pb-3 sm:px-4">
                {fields.map((field) => (
                  <ElicitationFieldRow
                    key={field.key}
                    field={field}
                    fieldId={`${request.requestId}-${field.key}`}
                    value={values[field.key]}
                    problem={attempted ? problemWithAnswer(field, values[field.key]) : null}
                    onChange={setValue}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-border bg-muted/40 px-3 py-2 sm:px-4">
            <Button type="button" variant="ghost" size="sm" onClick={handleDecline} className="finger:h-11">
              {t('mcpElicitation.decline', { defaultValue: 'Decline' })}
            </Button>
            {isUrlMode ? (
              canOpenUrl && (
                <a
                  href={input.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleOpenUrl}
                  className={cn(buttonVariants({ size: 'sm' }), 'finger:h-11')}
                >
                  {t('mcpElicitation.openLink', { defaultValue: 'Open link' })}
                </a>
              )
            ) : (
              <Button type="submit" size="sm" className="finger:h-11">
                {t('mcpElicitation.submit', { defaultValue: 'Submit' })}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
};

type ElicitationFieldRowProps = {
  field: ElicitationField;
  /** Unique across requests, so two open prompts never share a label's target. */
  fieldId: string;
  value: ElicitationRawValues[string] | undefined;
  problem: ElicitationProblem | null;
  onChange: (key: string, value: ElicitationRawValues[string]) => void;
  t: TFunction<'chat'>;
};

/** One field of the form, drawn by its kind. Private to McpElicitationPanel. */
function ElicitationFieldRow({ field, fieldId, value, problem, onChange, t }: ElicitationFieldRowProps) {
  const problemText = problem ? problemSentence(t, problem) : undefined;
  // A tick box always answers (unticked is false), so it is never marked optional.
  const label = !field.required && field.kind !== 'boolean'
    ? `${field.label} (${t('mcpElicitation.optional', { defaultValue: 'optional' })})`
    : field.label;

  if (field.kind === 'boolean') {
    return (
      <div>
        <Checkbox checked={value === true} onChange={(next) => onChange(field.key, next)} label={label} />
        {field.description && <p className="ml-[30px] text-xs text-muted-foreground">{field.description}</p>}
      </div>
    );
  }

  if (field.kind === 'multi') {
    const picked = Array.isArray(value) ? value : [];
    const toggle = (choiceValue: string, ticked: boolean): ElicitationFieldValue =>
      // Kept in the schema's order, so the answer does not depend on the order the person ticked.
      ticked
        ? field.choices.map((choice) => choice.value).filter((candidate) => candidate === choiceValue || picked.includes(candidate))
        : picked.filter((candidate) => candidate !== choiceValue);
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="vv-field__label">{label}</legend>
        {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
        <div className="flex flex-col gap-1.5">
          {field.choices.map((choice) => (
            <Checkbox
              key={choice.value}
              checked={picked.includes(choice.value)}
              onChange={(ticked) => onChange(field.key, toggle(choice.value, ticked) as string[])}
              label={choice.label}
            />
          ))}
        </div>
        {problemText && <p role="alert" className="vv-field__error">{problemText}</p>}
      </fieldset>
    );
  }

  return (
    <Field label={label} htmlFor={fieldId} helper={field.description} error={problemText}>
      {field.kind === 'choice' ? (
        <Select
          ariaLabel={field.label}
          placeholder={t('mcpElicitation.choose', { defaultValue: 'Choose…' })}
          // A choice is held as its position, so a blank enum value is still a value.
          value={typeof value === 'string' ? value : ''}
          options={field.choices.map((choice, index) => ({ value: String(index), label: choice.label }))}
          onChange={(next) => onChange(field.key, next)}
        />
      ) : (
        <Input
          id={fieldId}
          type={field.kind === 'text' ? field.inputType : 'text'}
          inputMode={field.kind === 'integer' ? 'numeric' : field.kind === 'number' ? 'decimal' : undefined}
          value={typeof value === 'string' ? value : ''}
          invalid={problem !== null}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      )}
    </Field>
  );
}
