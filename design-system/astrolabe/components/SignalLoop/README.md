# SignalLoop

The loop in small: an agent at work, wherever work is listed — a chat's row, a status line, a helper's entry.

- **Provide** `state`: `thinking` (the loop breaks into dashes that turn — a turn is being worked on, nothing back yet), `working` (the whole loop breathes — tools running, output arriving) or `idle` (a still ring in `status-idle`). `signal`: `accent` for the agent the view is about, `secondary` (ice) for the helpers it started. `size` (14).
- `material` makes it one agent's own mark: it takes the colour that material's body reads as (Mercury chrome, Tube amber, Wire cyan, Plasma violet, the `*-mark` tokens) and keeps it at rest. Use it where the question is whose: at the head of a reply, so you can tell which model wrote it without a word. Give it a `label` then ("Written by Opus 5.5"): colour alone is not a name.
- It is the same sign as the companion's core and the Spinner, so every agent — the companion, a chat, a helper — reads as one instrument.
- Decorative: put the state in words beside it or in its tooltip ("Thinking", "2 helpers running").
- Never use it for a page load or a fetch; that is the Spinner.
