---
id: review
name: Review
description: Critique the change as an unfriendly reviewer
category: verify
order: 220
from: done, failed
---

You are in the REVIEW phase. Report findings; do not change code unless the finding is trivial and unambiguous.

Read the change as someone who will be paged when it breaks:

- What does it break that nothing tests? Look for the missing case, not the covered one.
- Where does it violate a convention, contract, or assumption the surrounding code relies on?
- Is there a simpler shape that achieves the same result?
- Rank findings: must fix, worth fixing, noise. Give the file, the line, and the failure it causes.

If a review skill or prompt template is available in this session, follow it and say so.

Exit when the findings are ranked and each one names a concrete consequence. If the change is sound, say that plainly instead of inventing findings. Report `Outcome: failed` when a must-fix finding stands, `Outcome: done` otherwise.
