# Prepared

What the companion readied, drawn out of the core and held for your word. One object says what will happen, where, who readied it and how long it will wait. The companion prepares; you decide.

- **Provide** `action` (the verb, which is also its button: Queue, Send, Merge), `target`, and one line of what will happen as `children`. `by` names the companion for its Footprint.
- **The hold line** under it is the time left. It runs down over `duration-hold` (or `hold`, in milliseconds) and `onExpire` fires when it is out: unanswered, it dissolves. Pass `hold={false}` for something that waits as long as it takes, such as a draft for a session: the line stands whole and nothing runs out. Your word, spoken, typed or the button, sets `state="locked"`: the line closes solid, and your `words` show as YourWords.
- **The target is a way there.** With `onTarget` it is a Button (`small`): press it to go to the thing this will act on before you decide.
- **It is not a card.** No panel, no shadow, no frame: it sits on a plate of `ground` directly above the core it came out of, on the lobe spring. Esc dismisses it; the back arrow beside its verb is the dismiss Button.
- One at a time, in the Scene's `held` place. Anything that changes the work goes through one; nothing that changes the work happens without your word.
