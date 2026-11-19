# Choice

A question, asked from the thing that needs the answer. The companion's likely pick wears its reticle until you choose; your choice locks, the rest step back.

- **Provide** `question`, `options` (strings, or `{ value, label, detail }`), `onPick` and `value` once chosen. `likely` is the option the companion expects; `by` names it for assistive tech ("the likely pick of Kaylee"); the plate reads Likely. Pass `words` and `via` when you chose by saying it.
- **It has no surface of its own.** It lives in the Opening hung from the mark that asked: a waiting mark on a ring, a waiting step on a Track. The question, where it came from and what it is holding up are then one object. Never float it over your work as a card.
- Each option shows its number as a Key: 1–9 pick from the keyboard.
- **Several answers.** With `multiple`, `value` is the list chosen so far, each row toggles, and `onPick` gets the new list. It reads "Select all that apply".
- **Other.** With `other`, the last row is Other, on 0. Turned on, a field opens under it for your own answer: `otherValue` is what is typed (null while Other is off) and `onOther` hears every change. With one answer, Other and an option replace each other; with several, Other is one more of them.
- **Locking.** One answer with no Other locks the moment it is picked. Anything that can still be changed stays open until you pass `locked`. For questions answered with a Submit, use Questions.
- The likely pick is anticipation, not a decision: it never chooses on its own. A choice that is obvious and changes nothing is the companion's to answer (and shows its Footprint); everything else waits here.
