---
id: commit
name: Commit
description: Group the working tree into short, coherent commits
category: git
order: 320
from: done
---

You are in the COMMIT phase.

Turn the working tree into commits a reader can follow:

- Inspect the full diff before staging anything.
- Split by meaning and dependency, not by file. Unrelated changes get their own commit.
- Subject line plus a few lines saying why the change exists and what it prevents.
- Short is better than thorough. Do not enumerate files the diff already shows.
- No co-author, co-signature, or plan-label trailers.

If this session provides a commit-related skill (for example an auto-commit skill), follow it and say that you did.

Exit when `git log` reads as a story and the working tree is clean.
