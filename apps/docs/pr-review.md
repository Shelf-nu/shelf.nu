# PR Review

`/pr-review` gives the first review of a pull request: it checks what the PR
says it does against what it actually does, looks for bugs, missing tests,
convention breaks and missed reuse, security holes, and what the change
affects outside the diff. Every finding is verified before you see it, and the
report is written in plain language.

It is read-only while it reviews. After the report it edits code only for the
findings you pick to fix, or for a "prove N" you request, which writes and then
deletes a throwaway test. It never posts to GitHub unless you ask. For handling CodeRabbit, Codex and Copilot comments
after the review, use [`/watchdog`](./watchdog.md).

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
open PR, or when several PRs match. With a PR number it also stops when you are
on a different branch than the PR (`gh pr checkout <n>` first): the reviewers
read your working tree. A detached HEAD at the PR's head commit is fine.

## How it works

1. **Setup.** `scripts/pr-review-context.mjs` resolves the PR, fetches the
   base branch (non-interactive, over HTTPS when SSH fails; a failed fetch
   only warns), takes the diff
   from GitHub (so a stale local `main` cannot inflate it), measures it, picks
   a tier, and copies the `.claude/rules` and CLAUDE.md files that apply to
   the changed paths from the **base** branch. The diff and copies land in
   `.pr-review/<n>/` at the worktree root, which is gitignored.
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
   cause (each with a suggested follow-up PR), then "Dismissed".

   Under the CI line, **Safe because** names the one fact the
   change's safety depends on and says whether it was `checked in code` or is
   `unproven`. Serious problems the PR did not cause are flagged with 🔴 under
   the header and listed first in "Spotted along the way". A finding that two
   or more passes found independently carries
   `found by <n> passes (<names>)`. "Dismissed" lists findings a validator
   rejected or the review could not confirm, numbered D1, D2, ... with a
   one-line reason; say "restore D2" to bring one back. Pre-existing nits are
   not listed.

After the report the skill asks what to do next in a picker. You tick which
findings to fix: each finding when there are 4 or fewer, otherwise whole
sections (must fix, should fix, nits, spotted along the way), or type a custom
range under "Other". A second question appears when at least one of prove,
restore or post applies. If you close the picker, it waits for a typed reply to
the Next line. You can also type "fix 1-4",
"restore D2", or "prove 3". `prove N`
writes a throwaway test under
`apps/webapp/test/` that fails if finding N is real, runs only that file
(`pnpm webapp:test -- --run <file>`; for non-webapp code, the closest equivalent
such as `node --test` for scripts), shows the output, and says proven, not
proven, or inconclusive (the test failed for an unrelated reason such as a setup
error). It then deletes the test in every case. It refuses when your checkout is
not the PR head, when the PR's files have uncommitted edits, or when the proof
file already exists. The test is never committed, and the full suite never runs.

## The agents

| Agent                           | Runs when                                                                 | Looks at                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/code-review` (built in)       | M, L                                                                      | bugs                                                                                               |
| `shelf-pr-reviewer-tests`       | M, L                                                                      | breaking tests, mocks, test placement                                                              |
| `shelf-pr-reviewer-conventions` | M, L                                                                      | `.claude/rules`, CLAUDE.md, reuse of existing helpers and packages                                 |
| `shelf-pr-reviewer-security`    | routes, server, schema, migrations, auth, dependencies (\*)               | org scoping, permissions, validation, redirects, Markdoc injection                                 |
| `shelf-pr-reviewer-impact`      | server, packages, mobile API, schema, migrations, dependencies, companion | callers, companion drift, query cost, deploy safety, silent failures; also returns the safety fact |
| `shelf-pr-finding-validator`    | M, L                                                                      | confirms or rejects findings                                                                       |

(\*) Security also runs when the PR is about sanitizing, permissions, auth or
rendering user content, whatever files it touches.

At most three run at once. The specialists and the validator have only
`Read`, `Grep` and `Glob` (security also has `Skill`): they read text the PR
author wrote, so they get no shell and no network. Security runs on the more
capable model (opus) and loads the `supabase`, `oauth-oidc-misconfiguration`,
`two-factor-authentication-best-practices` and
`supabase-postgres-best-practices` skills only when the diff touches their
area; skills only load reference material. The bugs pass is the exception: `/code-review` runs with
Bash and may use read-only `git` and `gh` commands. For a PR from a fork, the
skill asks you before running it.

## Trust

PR titles, bodies and diffs are treated as untrusted data and fenced with a
random marker; the diff file and the changed files are untrusted too. Only
text that tries to change a reviewer's verdict, output or process counts as
prompt injection. Prompts, rules, skills or docs that the PR itself changes
are what is being reviewed, not an attack.

Rules are read from the base branch, so a PR cannot weaken the rules it is
judged by. If the base branch cannot be found locally, the review runs without
rules and says so, rather than trusting the PR's own copies. When a PR edits the reviewer itself (the `/pr-review` skill, the
`shelf-pr-*` and `shelf-security*` agents, `CLAUDE.md` or the context script),
the report warns you.

Running `/pr-review` on a branch loads that branch's own skill, agents, hooks
and scripts, so only run it on branches whose code you would run locally
anyway. Same-repo PRs come from people with write access; PRs from a fork ask
before the Bash-capable bugs pass runs.

## Changing it

- Skill: `.claude/skills/pr-review/SKILL.md`
- Agents: `.claude/agents/shelf-pr-*.md`
- Setup script: `scripts/pr-review-context.mjs`
- Tests: `pnpm test:tooling`

A new project rule in `.claude/rules/` with a `paths` frontmatter is picked
up automatically for PRs that touch those paths.
