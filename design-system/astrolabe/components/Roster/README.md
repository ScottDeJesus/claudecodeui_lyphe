# Roster

The agents at work right now, each with its loop, what it is doing and for how long. Present only while someone is working.

- **Provide** `agents`: `{ id, name, state, activity, since, helper }` — `state` is `thinking` or `working` (idle agents are left out), `since` an epoch time in ms for the elapsed clock, `helper` for one the companion started.
- Helpers indent under their agent and take the `secondary` (ice) loop; the companion and the agent you are looking at are `accent`.
- With nobody working it renders nothing. It is a list, so it lives inside an Opening or a Sheet. On screen the same fact is carried by the thing being worked on: its ring span crawls, and one small bead per helper rides behind the head (an item's `agents`). Open the mark and this is the list you find.
