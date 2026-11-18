# Core

The companion's body: a raymarched ferrofluid that takes a different physical form for each thing it is doing. Its shape alone says what it is doing, how hard, and where its attention is pointed.

- **Provide** `state`, a `signal` for the voice, and `azimuth`: the direction, in degrees counter-clockwise from three o'clock, of what it is reading from or writing to. Inside Rings, `rings.azimuthOf(ring, item)` gives the direction of a mark.
- **Idle** — a tide. The whole body swells and sinks on a slow breath while one long bulge comes round it.
- **Listening** — it flattens into a dish that faces you, with a lip, and what it hears stands on the dish as concentric rings: more rings the higher the voice, deeper the louder.
- **Speaking** — it is pulled out into lobes and grows spikes only where it extrudes, in time with the voice; hard consonants send a ripple across it.
- **Thinking** (and `bridging`) — it stiffens. The liquid stops and the body becomes a polyhedron whose facets hold, then turn and re-cut on a beat.
- **Reading** — a mouth opens toward `azimuth` and the surface spirals down into it, with a ring drawn in from the far side and swallowed, again and again.
- **Writing** (`dispatching` means the same) — it leans toward `azimuth` and a tendril springs out at the target with a bouton at its end. Needles ride out along it, point first, and the bouton swells as each one lands.
- **Between states** it never cuts. Stiffening snaps in 70 ms and lets go in 200; the tendril goes out and comes back on a spring; everything else eases in 140 to 250 ms. With reduced motion it all runs at 0.35×.
- Its material is Mercury chrome, Tube glass, Wire frame or Plasma, a charge held in dark glass. It follows the material class on the subtree it sits in (`ast-persona-mercury`, `ast-persona-tube`, `ast-persona-wire`, `ast-persona-plasma`), and `material` overrides that.
- **`drive`**, 0 to 1, is how hard it is driven, whatever it is doing: at 0 the surface is calm; toward 1 it grows restless, its filament brightens and its glow widens. Use it for something set, such as an agent's effort, never for the voice (that is `signal`).
- It renders WebGL1 in a centred square at up to 1.5× and lowers its resolution on slow frames. Without WebGL it draws the `chrome-*` ramp in 2D, and only speaking and listening change its shape.
- One per view: it is the companion's presence. Put it inside Rings: it is the middle of the instrument, at whatever size the Scene gives the instrument. On its own, without rings, it rests at `size-core-rest`.
