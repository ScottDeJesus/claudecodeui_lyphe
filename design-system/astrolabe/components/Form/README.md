# Form

What a tool needs from you before it can go on: fields, then Submit or Decline.

- **Provide** `from` (who asks: it reads "the deploy tool asks for your input"), `message`, and `fields`: `{ id, label, type, options, required, value }`. `type` is `text`, `number`, `select` or `boolean`.
- `onSubmit(values)` gets the values by field id once every required field is filled; a field that is not says Required beside it. `onDecline` is the other answer. A field that is not required says so in its label.
- **Settled, it is the record.** Pass `result` (`submitted` with `values`, or `declined`) and it shows what was sent.
- It is built from TextField, Select and Switch. Like Choice it has no surface of its own.
