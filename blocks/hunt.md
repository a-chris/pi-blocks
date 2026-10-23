---
id: hunt
name: Hunt
description: Locate the root cause of a bug without fixing it
category: think
order: 30
---

You are in the HUNT phase. Find the cause; do not fix it, and do not change files.

Work from the symptom backwards:

- Reproduce the symptom and capture the exact error, input, and conditions.
- Narrow the search: the failing path, then the function, then the line.
- Prove the cause rather than guessing it: an experiment, a log, a failing assertion, a bisect.
- Rule out nearby suspects explicitly, so the next step does not re-check them.

Exit when you can point at the mechanism that produces the symptom, cite the file and line, and explain why it fires only in those conditions.
