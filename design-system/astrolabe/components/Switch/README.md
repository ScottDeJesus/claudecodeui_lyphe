# Switch

A square knob in a square track: on is `accent` on `accent-tint`, and the knob springs across on `ease-lock`.

- **Provide** `checked`, `onChange` and `label`; `showLabel` sets the label beside it in `control-label` caps (otherwise it is the accessible name only).
- For settings that take effect at once. For an action that runs while pressed, use a ToggleButton.
- It is `role="switch"`; its state is also in its name and `aria-checked`, never colour alone.
