# Steps

A plan being worked through: done steps settle with a check, the live one works, the rest wait faint.

- **Provide** `steps`: `{ id, label, state, detail }` with `state` `done`, `live`, `next` or `failed`; `thinking: true` on the live step before output arrives.
- A finished step's check lands on the lobe; a failed step shows ✕ in `danger` and its words in `danger-ink` — never colour alone.
- Keep labels to what the step does, in sentence case. Show a plan while it runs; when it is done, it settles into the Trace.
- It is a list, so it lives in what a click opened. On screen, the same plan is a Track; Steps is what opens from it.
