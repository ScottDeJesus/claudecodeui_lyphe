# ToggleButton

A two-state control that stays down while its mode is on — in the instrument, Listen.

- **Provide** `pressed`, `onPressedChange(next)`, an `icon` and one word. It sets `aria-pressed` for you.
- Pressed shows an `accent` edge and label but keeps the `surface` fill, so it never competes with an active primary.
- Swap the word while pressed (Listen → Stop); keep the icon. With `iconOnly` it is the mark alone and the word is its title.
- Use for modes that run until stopped. Use Button for one-shot actions.
