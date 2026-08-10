---
description: Every PR opened for a bug fix must carry the GitHub "fix" label, applied at creation time
globs: ["**/*"]
---

# Label Fix PRs With `fix`

When you open a PR whose purpose is to fix a bug — anything you'd commit as
`fix(scope): …` under Conventional Commits — apply the repo's **`fix`** label.
Releases and triage filter on labels, so an unlabelled fix PR is invisible to
whoever assembles the changelog.

Apply it **at creation**, not as a follow-up — a PR that gets reviewed and
merged quickly may never come back around for the edit:

```bash
# ✅ Good — label lands with the PR
gh pr create --title "fix(assets): …" --body "…" --label fix

# ❌ Bad — unlabelled; relies on remembering a second command
gh pr create --title "fix(assets): …" --body "…"
```

Already opened it without the label? Fix it immediately:

```bash
gh pr edit <number> --add-label fix
```

The label must already exist on the repo — `gh pr create --label` fails the
whole command on an unknown label, which silently costs you the PR. Check with
`gh label list` before inventing a new one.

Note you only reach this step **after the user has pushed the branch** — pushing
is theirs, per the repo's git conventions.
