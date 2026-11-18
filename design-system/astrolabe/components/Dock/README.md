# Dock

The row of controls at the foot of the instrument: centred, wrapping, `space-8` apart, at most `size-dock` wide.

- **Only what acts on something present is in it.** Stop arrives when the voice starts speaking and leaves when it ends; a field arrives when there is a line to give. At rest a Scene's foot is the instrument and nothing else.
- **Children**, in this order: the TextField, the primary Button, toggles, the FileButton, the SegmentedControl.
- Place it `space-24` above the bottom edge; the transcript sits `space-40` above it.
- On narrow screens it wraps; the field keeps at least 240px before anything moves to a new row.
