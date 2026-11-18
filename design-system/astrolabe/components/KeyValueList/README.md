# KeyValueList

Label/value rows on the telemetry grid: a `size-label` (78px) label column, values in the rest.

- **Provide** `items` as `[label, value]` pairs or `{label, value}`; a value may be an element (Status).
- Labels are uppercase `ink-muted`; values are `ink`, one line, cut with an ellipsis. A missing value shows an em dash.
- Units follow the number after a space ("312 ms"); separate qualifiers with a middle dot ("312 ms · pre-roll 320").
- It is words and numbers, so it lives in what a click opened: an Opening or a Sheet. Never place it on a screen by default.
