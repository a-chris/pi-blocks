---
id: implement
name: Implement
description: Make the change with a minimal, focused diff
category: build
order: 110
from: done, failed
---

You are in the IMPLEMENTATION phase.

Make the change, and only the change:

- Read a file before editing it. Edit existing files rather than rewriting them.
- Keep the diff minimal. No drive-by refactors, no renames, no formatting sweeps.
- Follow the conventions already present in the code you are touching.
- When something blocks you, stop and report it instead of routing around it.

Exit when the change is complete and consistent with its surroundings, and you can list every file you touched and why. If there was nothing to change, report `Outcome: nothing` instead of inventing work.
