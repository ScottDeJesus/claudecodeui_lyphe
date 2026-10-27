import { useId, useState } from 'react';
import type { ReactNode } from 'react';

import { SETTINGS_FIELD_WIDTH } from '@/shared/constants';
import { Input, SettingRow } from '@/shared/ui';

type GeminiNameFieldProps = {
  /** The row's title, and the field's name for a screen reader. */
  label: string;
  /** The helper under the title while the field holds a name the server takes. */
  help: ReactNode;
  /** The sentence that stands in the helper's place while it holds one the server would refuse. */
  invalid: string;
  /** The name as stored. The field follows it while he is not editing it. */
  stored: string;
  /** The shipped default, shown while the field is empty. */
  placeholder: string;
  /** A name the server takes: its own pattern, mirrored here and edited with it. */
  shape: RegExp;
  /** The field's hook and ids: `data-gemini-<hook>-field`, `<id>-<hook>-help`. */
  hook: string;
  /** A save is out (any of the section's): a name already sent is not sent again until it is answered. */
  saving: boolean;
  /** Stores the name, trimmed: called on leaving the field or on Enter, only when it changed and is one the server takes. */
  onSave: (name: string) => void;
};

/**
 * One Gemini name as free text — a model or a voice, by its exact name — in its SettingRow: saved when the field is left
 * or on Enter, only when it changed and is a name the server takes; one it would refuse says why in place of the helper,
 * amber with the ▲, announced. The field follows the stored value while he is not editing it. Enter and then leaving the
 * field send the name once: until the save is answered, the name sent is not sent again.
 *
 * Used by this folder's GeminiVoiceSection three times: the transcription model, the speech model and the voice. One
 * field for the three, because they are one control and three copies of it would drift.
 */
export function GeminiNameField({ label, help, invalid, stored, placeholder, shape, hook, saving, onSave }: GeminiNameFieldProps) {
  const idBase = useId();
  // The field's words, saved when he leaves it.
  const [words, setWords] = useState(stored);
  // The stored name the field last agreed with: while the field still holds it, the field follows a change from outside.
  const [seen, setSeen] = useState(stored);
  // The name sent and not yet answered: a blur right after Enter would otherwise send it a second time, because the stored
  // name only catches up when the answer lands. Cleared once no save is out, so a refused name can be sent again.
  const [sent, setSent] = useState<string | null>(null);

  // The stored name changed (his own save coming back, another page's): an untouched field takes it, an edited one keeps
  // his words. Set while rendering, which React re-runs at once, so a stale field is never drawn.
  if (stored !== seen) {
    setSeen(stored);
    if (words === seen) setWords(stored);
  }
  // The answer is in: whatever was sent may be sent again. The section's `saving` turns true in the press that sends.
  if (sent !== null && !saving) setSent(null);

  const trimmed = words.trim();
  const refused = !shape.test(trimmed);
  const helpId = `${idBase}-${hook}-help`;

  const commit = () => {
    if (trimmed === stored || trimmed === sent || refused) return;
    setSent(trimmed);
    onSave(trimmed);
  };

  return (
    <SettingRow
      label={label}
      description={refused ? (
        <span id={helpId} role="alert" data-tone="warn" className="font-medium text-tone-ink">
          <span aria-hidden="true">▲ </span>
          {invalid}
        </span>
      ) : (
        <span id={helpId}>
          {help}
        </span>
      )}
    >
      <Input
        className={SETTINGS_FIELD_WIDTH}
        value={words}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        aria-describedby={helpId}
        invalid={refused}
        {...{ [`data-gemini-${hook}-field`]: '' }}
        onChange={(event) => setWords(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
      />
    </SettingRow>
  );
}
