---
description: Open every pull request as a draft and follow CONTRIBUTING.md until it is ready for review
---

# Follow The PR Process

Follow [CONTRIBUTING.md](../../CONTRIBUTING.md#the-pull-request-process). The
review queue shows only non-draft PRs with a review request.

```bash
gh pr create --title "fix(assets): ..." --body-file body.md          # ❌ ready on creation
gh pr create --draft --title "fix(assets): ..." --body-file body.md  # ✅ draft first
```

Mark it ready (`gh pr ready`) and request a review from @DonKoko only when:

- CI is green.
- CodeRabbit reviewed the latest commit: `@coderabbitai resume` if reviews
  are paused, `@coderabbitai full review` if it skipped a commit.
- Every CodeRabbit thread is fixed or answered, and resolved.
- The branch is up to date with `main`, no conflicts (`/fix-conflicts`).
- Team members: `/pr-review` must-fix and should-fix findings are fixed.

Outside contributors cannot request reviewers: they comment
`@DonKoko ready for review` and a maintainer adds the request. After feedback,
fix or answer each comment, resolve what you fixed, re-check the list, and
re-request the review. A push alone does not put the PR back in the queue.
