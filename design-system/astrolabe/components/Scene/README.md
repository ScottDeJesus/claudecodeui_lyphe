# Scene

The screen as an instrument and your work. With no work it is home, and the instrument has the center. With work, the instrument docks at the foot, small and still live, and leans in when you reach for it.

- **Provide** `instrument` always: a Hoop round a Core. Then `work` when something is being worked on; `controls` for what is present (a Composer, Stop while it speaks); `held` for what the companion says or holds for your word (a Stream, a Prepared action); and `opening` for the one Opening.
- **Home.** With no `work` the instrument grows to the center, up to `size-instrument-home`. This is the home screen: everything you have is on its hoop.
- **Docked.** With `work` the instrument sits at the foot at `size-instrument-rest` and keeps running: a slot's dashes still turn, a square still turns `accent`. Your work has everything above the foot.
- **Leaned in.** Reach for the docked instrument, with the pointer, with focus or with one touch, and it grows to `size-instrument-near` on a disc of `ground` over the corner of your work, so its hoop can be turned. It goes back when you leave it or press anywhere else, and it stays while an Opening hangs from it. `near` and `onNear` let you drive this yourself.
- It moves between the three sizes on `ease-lock` over `duration-lock`. Nothing else moves when it does: the instrument changing size never moves your work.
- There are no side columns. Nothing arrives as a card at an edge: what happens elsewhere shows on the object it belongs to.
