# Transcript

The spoken line, where weight is loudness and opacity is time.

- **Provide** `words` (array or string) and `active` — the index being spoken: -1 before speech, `words.length` when done. Set `live` and pass `signal` so the live word's weight follows RMS. Optional `weights`, `label`, `hint`, `history` (9), `lookahead` (3), `lines`.
- Words not yet spoken sit at `opacity-ghost`, weight 250. The live word is `ink-strong` and swells 300–780. Spoken words settle at `opacity-settled` with the weight of their own mean loudness (300 + 460·mean^0.8).
- Move `active` on the audio's word boundaries. Never pop whole words in karaoke-style or animate anything but weight and opacity.
- Centre it above the dock, `space-40` clear. It arrives with the first word and settles `duration-linger` after the last.
