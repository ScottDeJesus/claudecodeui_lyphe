# Readout

The one large live number in a panel — f0 in hertz — whose weight follows voicing.

- **Provide** `value`, `unit`, `note` (pitch name and cents), `source` ("Measured · YIN", "Prosody model", "Standby"), `voicing` (0–1 sets the weight, 200–520). Or pass `signal` and it reads f0, note and voicing live, updating text every `duration-tick`.
- One per panel, two decimals for hertz.
- No value shows "—" at `opacity-dim`; never show a stale number as if it were live.
- It opens from the part it measures. In a voice-first view wider than `size-telemetry-min` it may stay open while the voice is live; it is never on screen at rest.
