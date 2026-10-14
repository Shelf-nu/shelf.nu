# PR Review

`/pr-review` gives the first review of a pull request: it checks what the PR
says it does against what it actually does, looks for bugs, missing tests,
convention breaks and missed reuse, security holes, and what the change
affects outside the diff. Every finding is verified before you see it, and the
report is written in plain language.

It is read-only. It never edits code and never posts to GitHub unless you ask
after reading the report. For handling CodeRabbit, Codex and Copilot comments
after the review, use [`/pr-review-loop`](./pr-review-loop.md).

## Running it

From a checkout of the PR branch:

```bash
claude "/pr-review"          # the open PR for the current branch
claude "/pr-review 3191"     # a specific PR
```

Inside a session, type `/pr-review`. Handy alias:

```bash
alias prr='claude "/pr-review"'
```

It stops with a message on `main`, on a detached HEAD, when the branch has no
open PR, or when several PRs match.

## How it works

1. **Setup.** `scripts/pr-review-context.mjs` resolves the PR, takes the diff
   from GitHub (so a stale local `main` cannot inflate it), measures it, picks
   a tier, and copies the `.claude/rules` and CLAUDE.md files that apply to
   the changed paths from the **base** branch.
2. **Intent.** The PR's claims become a checklist: done, not done, or needs a
   human. Files that serve no claim and `fix`/`feat` mislabels are called out.
3. **Find.** Depends on the tier:

   | Tier | When                                                                  | What runs                                             | Target    |
   | ---- | --------------------------------------------------------------------- | ----------------------------------------------------- | --------- |
   | S    | up to 150 changed lines, no routes, server, schema or migration files | the session reviews inline                            | 2-3 min   |
   | M    | everything else                                                       | `/code-review` plus the specialists the diff triggers | 6-8 min   |
   | L    | over 1500 lines or 30 files                                           | M plus a scope and split table                        | 12-15 min |

   Lockfiles and snapshots do not count toward the size.

4. **Verify.** Findings are deduplicated. Each must-fix and should-fix is
   checked by a read-only validator that tries to disprove it.
5. **Report.** A verdict, an ELI5, then numbered findings: Must fix, Should
   fix, Nits, and "Spotted along the way" for real problems the PR did not
   cause (each with a suggested follow-up PR).

## The agents

| Agent                           | Runs when                                                                 | Looks at                                                             |
| ------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `/code-review` (built in)       | M, L                                                                      | bugs                                                                 |
| `shelf-pr-reviewer-tests`       | M, L                                                                      | breaking tests, mocks, test placement                                |
| `shelf-pr-reviewer-conventions` | M, L                                                                      | `.claude/rules`, CLAUDE.md, reuse of existing helpers and packages   |
| `shelf-security-reviewer`       | routes, server, schema, migrations, auth, dependencies                    | org scoping, permissions, validation                                 |
| `shelf-pr-reviewer-impact`      | server, packages, mobile API, schema, migrations, dependencies, companion | callers, companion drift, query cost, deploy safety, silent failures |
| `shelf-pr-finding-validator`    | M, L                                                                      | confirms or rejects findings                                         |

At most three run at once. The specialists and the validator have only
`Read`, `Grep` and `Glob`: they read text the PR author wrote, so they get no
shell and no network.

## Trust

PR titles, bodies and diffs are treated as untrusted data and fenced with a
random marker. Rules are read from the base branch, so a PR cannot weaken the
rules it is judged by. When a PR edits the reviewer itself (`.claude/`,
`CLAUDE.md`, the context script), the report warns you.

## Changing it

- Skill: `.claude/skills/pr-review/SKILL.md`
- Agents: `.claude/agents/shelf-pr-*.md`
- Setup script: `scripts/pr-review-context.mjs`
- Tests: `pnpm test:tooling`

A new project rule in `.claude/rules/` with a `paths` frontmatter is picked
up automatically for PRs that touch those paths.
