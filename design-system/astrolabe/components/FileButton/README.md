# FileButton

Picks a local file from a button-shaped label; the real file input stays reachable by keyboard and screen readers.

- **Provide** `accept` (`"audio/*"` in the instrument), `onFile(file)` (an array with `multiple`), a noun as `children` ("Audio file"). Its mark is the plus: a file is something you add, wherever you add it. With `iconOnly` it is the plus alone, the noun kept as its title.
- Focus shows the `focus` ring on the whole label. The input resets after each pick, so the same file can be chosen twice.
- Also accept the file dropped anywhere on the instrument; the button is the visible way in, not the only one.
