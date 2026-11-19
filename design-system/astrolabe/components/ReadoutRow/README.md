# ReadoutRow

Inline label/value pairs for the secondary numbers under a panel.

- **Provide** `items`: `{label, value, tone}` (`tone: 'muted'` for trailing units, `'accent'` for a locked status); `align`; `spacing="wide"` for vector components.
- Labels are uppercase `ink-muted`, values `ink`. Signs are explicit: + and a true minus (−), never a hyphen.
- It is numbers in words, so it lives in what a click opened. Never place it on a screen by default.
