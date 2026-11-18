// The microphone tap her face listens through. Her ears engine captures his voice (microphone stream -> capture worklet); while a
// capture is attached it also branches the stream into an analyser and publishes it here, and her face's ear reads it while she is
// listening. A page has one pair of ears, so there is one tap or none.

// The tap of the capture attached now, or null while her ears hold no microphone.
let attachedTap: AnalyserNode | null = null;

/**
 * Used by this module's ears engine: publishes the tap of the capture it just attached, or clears it when that capture comes apart.
 * A clear names the tap it attached, so the teardown of an older capture cannot clear a newer one.
 */
export function publishListeningTap(tap: AnalyserNode | null, clearing?: AnalyserNode): void {
  if (tap === null && clearing !== undefined && attachedTap !== clearing) return;
  attachedTap = tap;
}

/** Used by this module's CompanionAvatar: the analyser to read while she listens, or null when her ears hold no microphone. */
export function listeningTap(): AnalyserNode | null {
  return attachedTap;
}
