# Sheet

A summoned panel over a dimmed ground: history, settings, anything that is not on screen until you call it up.

- **Provide** `open`, `onClose`, `title` and the content as `children`. `from`: `dock` (default) rises from the foot; `end` comes in from the right edge, full height.
- Render it inside the Scene (or any positioned container): it covers that container, not the window. Escape, the scrim and the back arrow at its head all close it, and focus returns to where it was.
- It sits on `panel` at `radius-sheet` with `shadow-modal`, and arrives on `ease-lock`; the scrim is `ground` at 72%.
- One at a time. Never open one on its own: a sheet is always something you asked for.
