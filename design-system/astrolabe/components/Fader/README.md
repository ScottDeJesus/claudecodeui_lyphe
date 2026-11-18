# Fader

A value on a ticked hairline. The fill and the pointer spring to every change, whether you drag it or something sets it.

- **Provide** `value`, `onChange`, `label`; `min` and `max` (0–1), `step`, and `unit`, `decimals` or `format` for the readout.
- The readout is mono, tabular; the fill and pointer are `accent` on `track`; ticks every tenth, longer every half.
- **Detents.** Pass `detents`, the values that matter (1× speed, the default size), and the ticks become those values: the pointer catches on one as it passes, grows to say it is caught, and the tick turns `accent`. The marks are then the scale, the presets and the sign of where you are at once.
- It is a native range input underneath: arrows, Page Up and Down, Home and End all work.
