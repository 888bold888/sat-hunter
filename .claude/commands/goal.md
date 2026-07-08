---
description: Work on a goal spec from tasks/goals/ using the builder/verifier loop
argument-hint: "[goal-name] — omit to list goals and continue the active one"
---

Work toward a long-running goal defined in `tasks/goals/`.

## Resolve the goal
- If an argument is given, open `tasks/goals/$ARGUMENTS.md` (fuzzy-match the name).
- If not, list `tasks/goals/*.md` with their **Status** lines; if exactly one is
  in progress or not started, continue that one, otherwise ask which.

## Before working
1. Read the goal file fully — design, hard constraints, phases, progress log.
2. Read `tasks/lessons.md` (required by CLAUDE.md).
3. Verify the goal's assumptions against the actual code (field names and
   constants in specs go stale — read the real types first).

## Work loop
1. Pick the first unchecked phase. Break it into concrete tasks.
2. Implement with the **builder** agent (or directly for small changes).
3. Run `npm run test` — the proof-of-work command — after each task.
4. Check completed work with the **verifier** agent against the goal spec.
5. Check off the phase in the goal file and append a dated entry to its
   Progress log (what landed, commits, anything discovered that changes the plan).
6. Continue to the next phase if the session has room; otherwise leave the goal
   file accurate enough that the next `/goal` run can resume cold.

## Rules
- Respect every item under the goal's "Hard constraints" section.
- Never `npm run deploy` or publish Nostr events.
- If reality contradicts the spec, update the spec (and `tasks/lessons.md` if it
  was a repeated mistake), then proceed — don't silently diverge.
- Update the **Status** line (`not started` → `in progress` → `done`).
