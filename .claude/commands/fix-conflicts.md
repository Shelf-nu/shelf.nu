---
description: Resolve the conflicts left by merging main (or another branch) into the current branch, verify the result, and conclude the merge commit.
argument-hint: "[extra context, e.g. which side wins in a file]"
---

I merged another branch (usually `main`) into the current branch and it stopped
on conflicts. Resolve them, verify, and conclude the merge. Extra context from
me, if any: `$ARGUMENTS`

## 1. Establish the state

- `git status` and `git rev-parse -q --verify MERGE_HEAD`.
- **A merge is in progress:** continue below. Note what was merged in with
  `git log -1 --format='%h %s' MERGE_HEAD`.
- **A rebase or cherry-pick is in progress instead:** stop and ask. Do not
  continue or abort it yourself.
- **Nothing is in progress:** grep tracked files for leftover markers
  (`git grep -nE '^(<<<<<<<|=======$|>>>>>>>)'`). If there are none, say there
  is nothing to fix and stop. Do not start a merge on my behalf.

## 2. Resolve each conflicted file

List them with `git diff --name-only --diff-filter=U`. For every file:

1. Understand **both intents** before editing. Read the hunks, then what each
   side was doing: `git log --oneline MERGE_HEAD ^HEAD -- <file>` (incoming) and
   `git log --oneline HEAD ^MERGE_HEAD -- <file>` (ours). Read the commit
   messages and diffs when the intent is not obvious from the hunk.
2. Keep both changes wherever they are compatible. A conflict is almost never
   "pick one side": usually the branch's new behaviour has to be re-applied on
   top of what the incoming branch restructured (renamed function, moved file,
   new param).
3. When the two sides genuinely contradict each other and the right answer is a
   product decision, do not guess: leave that file, finish the rest, and ask me
   with both options laid out.
4. The result must follow `.claude/rules/` and `CLAUDE.md`, the same as any new
   code.

Special files:

- `pnpm-lock.yaml`: never hand-merge. Take the incoming side's version
  (`git checkout --theirs pnpm-lock.yaml`; during a merge `--theirs` is
  `MERGE_HEAD`, whichever branch was merged in), then run `pnpm install` so the
  current branch's dependency changes are re-applied against the merged
  manifests.
- `packages/database/prisma/migrations/`: never edit or renumber a migration
  that is on the incoming branch. If both sides added migrations, keep both. Run
  `pnpm db:generate` if the schema changed. Never run `db:prepare-migration` or
  `db:deploy-migration`.
- Generated files (route typegen, Prisma client): regenerate, do not merge.

## 3. Look past the markers

A clean textual merge can still be broken. Check for **semantic** conflicts in
files git merged silently: callers of anything the incoming branch renamed or
re-typed,
imports of moved modules, new required params, tests for code the branch
changed. `git diff MERGE_HEAD -- <path>` shows what the branch adds relative to
the incoming side.

## 4. Verify

- No markers remain: `git diff --check` and the grep from step 1.
- If `package.json` or `packages/*` changed on either side, `pnpm install`
  first (see `.claude/rules/run-pnpm-install-when-workspace-packages-change.md`).
- Typecheck and lint for each touched package.
- Run the tests for each touched workspace: `pnpm webapp:test:changed` for the
  webapp (never the full webapp suite), `pnpm companion:test` for
  `apps/companion`, and `pnpm --filter <package> test` for each touched
  `packages/*` workspace. Run `webapp:test:changed` even when only a package
  changed: webapp tests import the packages.
- Fix failures the merge caused; report, but do not fix, failures that also
  happen on the incoming branch.
- Prettier on the files you edited, by explicit path.

## 5. Conclude

Stage only the files you resolved or fixed, by explicit path. Then check the
index with `git diff --cached --name-only`: every staged path must either differ
between `HEAD` and `MERGE_HEAD` (the incoming side's clean changes, which belong
in the merge commit, so never unstage them) or be a file you resolved or fixed.
If anything else is staged, stop and ask before committing.

Conclude with `git commit --no-edit` (keep git's default merge message). Running this command
is the request to make that merge commit. Do **not** push.

Report: what was merged in, each conflicted file and how it was resolved (one
line each), any semantic fixes outside the conflicted files, the verification
results, and the merge commit SHA. List anything you left for me to decide.
