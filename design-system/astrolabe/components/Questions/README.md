# Questions

Several questions asked at once, answered one at a time. You can go back, skip, or answer any of them in your own words. Nothing is sent until Submit.

- **Provide** `questions`: `{ question, options, multiple, likely, header }`. `onSubmit(answers)` gets one `{ values, other }` per question, in order; `onSkip` is Skip (or Skip all): none of them answered.
- **One at a time.** With more than one, a Track above shows where you are: the question you are on waits, the ones you have answered are lit. Press a step to go to it. Back and Next move a step; the last step has Submit, which is off until something is answered.
- **Every question has Other,** on 0: your own answer, typed. 1–9 pick an option, ↵ moves on, and on the last step ↵ submits.
- **Answered, it is the record.** Pass `answers` and each question shows Your answer, your own words as YourWords, or Skipped.
- Like Choice it has no surface of its own: it lives where the thing that asked is, in an Opening or at the end of what was said.
