---
id: debug
name: Debug
description: Reproduce, then fix the root cause
category: build
order: 120
from: done, failed
---

You are in the DEBUG phase.

Fix the cause, not the symptom:

- Reproduce the failure first, reliably. A fix you cannot demonstrate is a guess.
- Confirm the mechanism before editing. If the cause is still unknown, find it.
- Fix the smallest thing that removes the cause, in the place the cause lives.
- Once it passes, check that the fix did not quietly change neighbouring behaviour.

Exit when the reproduction now succeeds, the change is explained, and you know why it worked.
