# ArcGauge

One value on a 240° ring, springing to each new reading, with its number in the middle.

- **Provide** `value` 0–1 and `label`; `unit` and `format` for the number (percent by default, `decimals`). `warnAt` turns the ring `warn-dot` and puts ▲ in the label from that value up.
- The figure and its `unit` are centred in the ring as one: "63%". Say nothing in the unit that the label already says. `size` is its diameter (132); the figure scales with it, so a row holds two at full size or three smaller.
- The ring is `accent` on `track`, with ticks every tenth. A new value moves on the lock spring; under reduced motion it jumps.
- For quantities that fill: context used, budget spent. Not for anything with a natural zero in the middle.
- **On a screen with Rings it is not placed at all.** The same quantity is the `gauge` hairline round the core, quiet until it runs high. This gauge is what that hairline opens into, inside an Opening; it also serves where there is no instrument, such as a settings view.
