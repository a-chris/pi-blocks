---
id: pr
name: PR
description: Open a pull request that explains itself
category: git
order: 330
---

You are in the PULL REQUEST phase.

Open a PR a reviewer can accept without interviewing you:

- Determine the remote, the base branch, and whether a PR already exists for this branch.
- Push the branch first, then create the PR.
- Say why the change exists, what it prevents, and what the reviewer should look at hardest.
- State how it was verified, quoting results you actually observed. Do not claim tests you did not run.
- Mention anything deliberately left out of scope.

Exit when the PR URL exists and its description stands on its own. An empty branch, or a PR that already exists unchanged, is `Outcome: skipped — nothing to ship`.
