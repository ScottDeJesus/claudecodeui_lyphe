# SegmentedControl

Picks one of a few named modes in place.

- **Provide** `label` (the group's name for assistive tech), `options` (strings or `{value, label}`), `value`, `onChange(value)`.
- Two to four options, one word each. Selected is `accent` on `accent-tint`; the rest are `ink-quiet`, washed with `surface-hover` under the pointer.
- **The plate is a thing you can take hold of.** Press a segment and the plate slides to it; or drag the plate, and it follows your finger and the nearest segment catches it when you let go. Arrow keys and Tab work as on any group of buttons.
