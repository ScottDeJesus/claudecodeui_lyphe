# TextField

The single line you give the voice.

- **Provide** `label` (visually hidden unless `showLabel`), `placeholder`, `value`/`onChange` or `defaultValue`, `onEnter(value)`, `inputRef`. Other input attributes pass through.
- The placeholder is an instruction ending in an ellipsis: "Give it a line to speak…".
- Enter speaks; Escape should stop — wire `onKeyDown` for that.
- The edge is `border-strong` (3:1) because it is the only sign of a place to type. In a Dock it takes the spare width.
