---
description: Open every pull request as a draft and follow CONTRIBUTING.md until it is ready for review
---

# Follow The PR Process

Every PR goes through the process in
[CONTRIBUTING.md](../../CONTRIBUTING.md#the-pull-request-process). The review
queue only shows PRs that are not drafts and have a review request, so marking
a PR ready too early puts unfinished work in front of the reviewer.

```bash
# ❌ Bad: ready for review on creation
gh pr create --title "fix(assets): ..." --body-file body.md

# ✅ Good: draft first
gh pr create --draft --title "fix(assets): ..." --body-file body.md
```

Mark it ready (`gh pr ready`) and request a review from @DonKoko only when all
of these hold:

- CI is green.
- CodeRabbit has reviewed the latest commit. If it skipped one, comment
  `@coderabbitai review` (or `@coderabbitai resume` when paused).
- Every CodeRabbit thread is fixed or answered, and resolved.
- The branch is up to date with `main` with no conflicts (`/fix-conflicts`).
- `/pr-review` has run and its must-fix and should-fix findings are fixed.

After review feedback: fix or answer each comment, resolve the threads you
fixed, go through the list again, then re-request the review. Pushing alone
does not put the PR back in the queue.
