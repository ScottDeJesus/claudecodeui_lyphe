# Button

The dock's action button: one primary per view (Speak), quiet everywhere else.

- **Provide** one uppercase word as `children`; `variant="primary"` for the action the view exists for; `icon` (any Icon name: `play`, `stop`, `mic`, `plus`); `active` while that action runs. Any `<button>` attribute passes through.
- **Anything you can press to act is this.** Never make bare words pressable: text that acts with no edge does not read as a button. For an act that belongs to one line of a list (Use, Edit, Remove, Open), use `size="small"`, the same button at `size-row`. `variant="danger"` is for an act that destroys.
- **Primary** sits on `surface-raised` with a `border-strong` edge. **Active** turns edge and label `accent` over `accent-tint`.
- While the action runs, swap label and icon on the same button (Speak ▸ → Stop ■) and set `active`. Never add a second button for Stop.
- At most one primary per view. Height is `size-control`, or `size-row` when it is `small`.
- **Don't label a button whose mark says it.** Stop, Send, File, Listen and Back are understood from the mark: pass `iconOnly` and the button is its mark alone, a square of `size-control`, with the word kept as its title and its name for assistive tech. A button with no mark, or one whose mark does not say what it does (Queue, Compact, Submit), keeps its word.
- Don't use colour alone: the label changes with the state.
