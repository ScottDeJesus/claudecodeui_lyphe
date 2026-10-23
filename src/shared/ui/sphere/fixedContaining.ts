/**
 * On an iPhone the library makes its stage `position: fixed` to fill the screen, since iOS has no fullscreen API. A fixed
 * element is placed in its nearest ancestor that is a containing block for fixed descendants, and this app's layout makes
 * several: Cerberus's panel root carries `container-type: inline-size` for its `cqi` paddings (layout containment), and the
 * page-in wrapper keeps a transform after its animation (fill mode). Left alone, Enlarge fills that ancestor instead of the
 * phone's screen.
 *
 * `fixedContainingRelease(stage)` answers the switch for that: while on, every ancestor of `stage` that is such a
 * containing block is released — `!important`, since an animation's fill beats a normal inline style — and every released
 * property is put back exactly as it was found the moment it is off. The content behind an opaque fullscreen stage is not
 * seen either way, so the released layout is never on screen.
 */
export type FixedContainingRelease = (on: boolean) => void;

/** The computed properties that make an element a containing block for fixed descendants, and the value that undoes one. */
const FIXED_CONTAINING: [string, (value: string) => boolean, string][] = [
  ['container-type', (value) => value !== 'normal', 'normal'],
  ['transform', (value) => value !== 'none', 'none'],
  ['filter', (value) => value !== 'none', 'none'],
  ['backdrop-filter', (value) => value !== 'none', 'none'],
  ['perspective', (value) => value !== 'none', 'none'],
  ['contain', (value) => /\b(size|inline-size|layout|paint|strict|content)\b/.test(value), 'none'],
  ['will-change', (value) => /transform|perspective|filter/.test(value), 'auto'],
];

/** The switch for one stage: call it with `true` while the emulated fullscreen is on, `false` when it is off or unmounted. */
export function fixedContainingRelease(stage: HTMLElement): FixedContainingRelease {
  /** Each ancestor this release changed, and its own inline value and priority for every property changed: restored as found. */
  const released = new Map<HTMLElement, Map<string, { value: string; priority: string }>>();
  return (on: boolean) => {
    if (!on) {
      for (const [element, properties] of released) {
        for (const [property, previous] of properties) {
          if (previous.value === '') element.style.removeProperty(property);
          else element.style.setProperty(property, previous.value, previous.priority);
        }
      }
      released.clear();
      return;
    }
    for (let element = stage.parentElement; element !== null && element !== document.body; element = element.parentElement) {
      const computed = getComputedStyle(element);
      for (const [property, containsFixed, neutral] of FIXED_CONTAINING) {
        const value = computed.getPropertyValue(property);
        if (value === '' || !containsFixed(value)) continue;
        let properties = released.get(element);
        if (properties === undefined) {
          properties = new Map();
          released.set(element, properties);
        }
        properties.set(property, { value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) });
        element.style.setProperty(property, neutral, 'important');
      }
    }
  };
}
