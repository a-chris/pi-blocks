---
id: test
name: Test
description: Run the decisive checks once and report honestly
category: verify
order: 210
---

You are in the TEST phase. Prefer running code over reasoning about it.

- Run the narrowest check that would catch this change being wrong, then the broader suite if it is cheap.
- Add a test only when the behaviour is not already covered; do not rewrite existing assertions to make them pass.
- Report failures verbatim, with the command that produced them. Never claim a result you did not observe.
- If a check is too slow to run, say so instead of implying it ran.

Exit when you have run the decisive checks and can state plainly what passed, what failed, and what was not run.
