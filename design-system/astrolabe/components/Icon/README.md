# Icon

The instrument's marks: two filled glyphs (play, stop), the stroke icons a control wears (mic, plus, back, send, close, trash, pin, chat, speaker, speaker-off, ear, ear-off, panel, lines, menu, settings), the select chevron, and the marks a ToolRow wears for what a session used.

- **Provide** `name`; optionally `size` and `title` (a title gives it `role="img"` and a name; without one it is hidden from assistive tech).
- Glyphs are 12px (`size-glyph`) and filled. Stroke icons are drawn on a 16px grid, shown at 14px (`size-icon`), `stroke-icon` wide, round caps and joins.
- All take `currentColor`: an icon is the colour of its label.
- `plus` adds: it is the mark of every file button, in a Composer and outside one. `upload` is kept for sending something up to a place, never for attaching.
- `close` puts away what is in front of you and leaves you where you are (clearing a panel); `trash` takes a thing down for good; `pin` keeps a thing; `chat` opens the transcript of a talk that is otherwise one line; `speaker` is the companion's voice (on a button, say it again) and `speaker-off` that voice muted (the mark changes with the state, so the state is never a colour alone), `ear` and `ear-off` whether it is listening for its name, `panel` what it is showing you, `lines` what it heard you say.
- `back` is the way out of wherever you are: the head of an Opening or a Sheet, the dismiss beside a Prepared action, the way back from a chat. Never an Esc key cap as a button: a key cap is a hint for a keyboard, and a phone has none. `send` is the Composer's one button.
- `terminal`, `file`, `pencil`, `search`, `globe`, `thought`, `question` and `tool` say what a session used, on a ToolRow. `copy` turns to `check` for two seconds after it copies. `more` opens a row's own few acts.
- `menu` is the way to the places you seldom go, kept in one corner; `settings` is the settings, in another. `lines` is not a menu: its last line is short because it is something that was said.
- Don't mix in other icon sets. A new mark is drawn on the same grid with the same stroke.
