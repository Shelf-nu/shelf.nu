# Contribute to Shelf

We really appreciate your interest in contributing to Shelf! Any kind of
contribution helps, not only code. Wondering what is up for grabs? Check out
the issues labelled
[Open for contributions](https://github.com/Shelf-nu/shelf.nu/labels/%F0%9F%90%9D%20Open%20for%20contibutions).

This guide is for everyone who opens a pull request: outside contributors and
the Shelf team alike. The PR process below is the same for both.

If you get stuck, open an issue or join us on
[Discord](https://discord.gg/8he9W7aTJu).

## Set up

**Prerequisites:** Node.js 24.22.1 or newer and pnpm 9.15 or newer.

1. Fork the [repository](https://github.com/Shelf-nu/shelf.nu) and clone your
   fork. Team members can branch in the main repository instead.
2. Follow the [Get started guide](https://docs.shelf.nu/local-development) to
   set up your local environment.
3. Create a branch from an up-to-date `main`.

## Make your change

- Keep a PR to one change. Small PRs get reviewed sooner and run into fewer
  conflicts. If you find an unrelated problem on the way, open a separate PR or
  an issue for it.
- Write commit messages in the
  [Conventional Commits](https://www.conventionalcommits.org/) format. The
  `commit-msg` hook runs `commitlint` to check them. Body lines are at most 100
  characters.
- Before you push, run the checks for what you changed:
  `pnpm webapp:validate` runs lint, typecheck and the tests affected by your
  change, and `pnpm docs:build` builds the docs site when you changed
  `apps/docs/` or this guide. CI runs the full suite on every PR.
- Follow the conventions in
  [CLAUDE.md](https://github.com/Shelf-nu/shelf.nu/blob/main/CLAUDE.md) and
  [`.claude/rules/`](https://github.com/Shelf-nu/shelf.nu/tree/main/.claude/rules).
  They apply to human and AI-written code alike.

## The pull request process

Every PR moves through the same stages. The maintainer review queue only shows
PRs that are **not drafts** and have a **review request**, so those two signals
are how you tell us a PR is ready.

### 1. Open the PR as a draft

Open every PR as a **draft**, even when you think it is finished. In the
description, say what the change does, why, and how you tested it. Link the
issue it closes ("Closes #123").

A draft is not hidden: CodeRabbit and CI run on it as usual. You can push to it
as often as you like.

### 2. Get it ready

While the PR is a draft, work through this list. Do not request a review until
every item is done.

- [ ] **CI is green.** Every check passes. A failing check unrelated to your
      change still needs a comment on the PR explaining it.
- [ ] **CodeRabbit reviewed every commit.** CodeRabbit reviews each push. It
      can still skip commits, for example when it is rate limited or a review
      fails. Check that its latest review covers your latest commit. If it does
      not, comment `@coderabbitai review` (or `@coderabbitai resume` if it says
      reviews are paused). If it skipped because of a rate limit, comment
      `@coderabbitai rate limit` to see when it resets, and ask again after
      that.
- [ ] **Every CodeRabbit thread is resolved.** Fix the finding, or reply with
      why it does not apply, then resolve the thread. Do not leave threads open
      for the maintainer to sort out.
- [ ] **The branch is up to date with `main` and has no conflicts.** Merge
      `main` into your branch (do not rebase a branch that is already pushed).
      With Claude Code, the [`/fix-conflicts`](https://github.com/Shelf-nu/shelf.nu/blob/main/.claude/commands/fix-conflicts.md)
      command resolves the conflicts, verifies the result and concludes the
      merge commit.
- [ ] **Team members: run `/pr-review`.** With Claude Code, run the
      [`/pr-review`](https://docs.shelf.nu/pr-review) skill on the PR and fix
      its must-fix and should-fix findings. Paste its verdict line in a PR
      comment. Outside contributors are welcome to run it too, but it is not
      required.

### 3. Mark it ready and request a review

When the list above is done:

1. Click **Ready for review** on the PR.
2. Request a review from [@DonKoko](https://github.com/DonKoko).
   **Outside contributors:** GitHub only lets people with write access request
   reviewers, so comment `@DonKoko ready for review` instead. A maintainer
   then adds the review request.

A PR that is still a draft, or has no review request, is not in the review
queue and will not be reviewed.

You can keep pushing after this point. Each push gets a new CodeRabbit review,
so the "Get it ready" list still applies to every new commit.

### 4. Respond to the review

The review happens on the PR itself. When changes are requested:

1. Address each comment: fix it, or reply with why you disagree.
2. Resolve the threads you fixed. Leave a thread open only when you replied
   with a question or a disagreement.
3. Go through the "Get it ready" list again for the new commits: CI green,
   CodeRabbit has reviewed them, its new threads resolved, no conflicts with
   `main`.
4. Click **Re-request review** next to the reviewer's name (outside
   contributors: comment `@DonKoko ready for another review`). That is the
   signal that the PR is ready to look at again; pushing alone is not.

This repeats until the PR is approved.

### 5. Merge

A maintainer merges the PR once it is approved and CI is green. Please do not
merge your own PR.

## Contributions to the companion app

The companion mobile app in `apps/companion/` is not under AGPL-3.0. It has its
[own license](https://github.com/Shelf-nu/shelf.nu/blob/main/apps/companion/LICENSE),
which does not allow distribution.

- **Forking and cloning are fine.** You can fork this repository on GitHub and
  clone your fork to contribute to the rest of Shelf, even though both copies
  contain `apps/companion/`. GitHub's
  [Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#5-license-grant-to-other-users)
  let every user fork a public repository, and we allow the local clone that
  the steps above need. The companion license applies to anything else you do
  with that folder.
- **Changes to `apps/companion/` need an agreement first.** We can accept a
  pull request that changes files in that folder only under a separate written
  agreement with Shelf Asset Management, Inc. Please open an issue before you
  start work there.
