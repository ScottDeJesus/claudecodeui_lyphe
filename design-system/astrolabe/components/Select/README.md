# Select

A compact chooser for long lists (voices), labelled in the telemetry column.

- **Provide** `label` (drawn as the 78px uppercase column; omit it for a bare select and pass `aria-label`), `options` (strings or `{value, label}`), `value`, `onChange(value, event)`, `disabled`.
- Option labels read "Name · lang".
- With nothing to choose, disable it and make the reason its only option ("No speech engine").
- Fill is `surface-solid`, so the native list never shows the canvas through it.
