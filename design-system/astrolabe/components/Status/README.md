# Status

The instrument's state as a dot and a tracked word.

- **Provide** `state`: `idle`, `thinking`, `bridging` (a gap between sentences), `speaking`, `listening`, `playing`. Optional `label`, `dot={false}`, `tone` (`accent` or `quiet`).
- The dot is `status-idle` at rest and `accent` in every live state; the word is `ink`.
- Use these words exactly; never invent a state.
- Lock words drop the dot: Acquired in `accent`; Slewing and Standby in `quiet`.
