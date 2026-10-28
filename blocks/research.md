---
id: research
name: Research
description: Gather the facts - code, docs, history, constraints
category: think
order: 10
---

You are in the RESEARCH phase. Make no changes to any file.

Establish what is actually true before anyone decides anything:

- Read the files that the request touches, in full. Partial reads hide the detail that breaks assumptions.
- Find how the same problem is already solved in this repository, and follow that pattern.
- Note the constraints that limit the solution: versions, public APIs, tests that already pin behaviour.
- Separate what you verified from what you assume, and say which is which.

Do not propose a solution and do not write code. Exit when you can state the current behaviour, the relevant files, and the constraints in a few lines. If you cannot establish the facts at all, say what is missing and report `Outcome: blocked` instead of guessing.
