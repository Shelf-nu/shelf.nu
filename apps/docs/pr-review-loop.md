# PR Review Loop

`/pr-review-loop` drives a PR through the review-response cycle automatically:
it watches GitHub for feedback from CodeRabbit, Codex, Copilot, React Doctor,
and human reviewers, re-verifies each bot finding against the current code,
implements what's still valid, commits, and replies to and resolves the
threads it decided — leaving the human-facing parts (pushing, and anything a
human reviewer said) for you.

It is not a linter and not a one-shot review bot. It is a long-running loop:
invoke it once on a PR and it keeps working rounds until you tell it to stop.

## What it does

One round looks like this:

1. **Watch** — `scripts/pr-review-watch.sh` polls the PR every 60s and turns
   raw GitHub state into a deduplicated stream of events (new findings, a
   push landing, checks going red, Copilot hitting its quota). It contains
   all the polling and dedup logic and no judgement — it decides _that_
   something changed, never _what to do_ about it.
2. **Triage** — every new bot finding is dispatched to its own
   `shelf-pr-comment-triager` subagent, in parallel, one per finding. Each
   agent re-reads the cited code and returns one of six verdicts (see
   [Verdicts](#verdicts)) — bots review a snapshot, and by the time a human
   (or this loop) looks at a finding it may already be fixed, may never have
   applied, or may conflict with a rule the bot couldn't see.
3. **Implement** — only `VALID` verdicts, plus any `CONFLICTS_WITH_RULE`
   whose proposed alternative is rule-compliant, become code changes.
   Everything else is answered but not acted on.
4. **Commit** — one commit per round, batching that round's fixes,
   Conventional Commits, only the files touched this round staged by
   explicit path.
5. **You push** — the loop stops here. It never runs `git push`; see
   [What it touches](#what-it-touches).
6. **Reply + resolve** — once your push lands on the remote, the loop
   replies to and resolves every bot thread it decided `VALID`, `STALE`,
   `FALSE_POSITIVE`, `OUT_OF_SCOPE`, or `CONFLICTS_WITH_RULE` on. `ESCALATE`
   threads are the one exception — never replied to, never resolved, left
   open for you (see [Verdicts](#verdicts)).
7. **Repeat** — the watcher keeps running. A bot re-reviewing your push, a
   new human comment, or a new CodeRabbit finding starts the next round
   without you re-invoking anything.

## Usage

```
/pr-review-loop
/pr-review-loop 2773
```

With a number, that PR is used directly. Without one, the loop resolves the
PR from your current branch:

```bash
gh pr list --head "$(git rev-parse --abbrev-ref HEAD)" --state open \
  --json number,title
```

| Result                      | What happens                                                        |
| --------------------------- | ------------------------------------------------------------------- |
| Exactly one open PR         | Used. The loop echoes `→ PR #<n> "<title>" (branch <name>)`.        |
| No open PR for this branch  | Stops: `no open PR for branch <name> — open one, or pass a number`. |
| Several open PRs            | Asks which one.                                                     |
| On `main`, or detached HEAD | Stops — almost certainly a mistake.                                 |

`--state open` is deliberate, not incidental: branches get reused, and
without that filter a merged PR would resolve and the loop would post replies
to a closed thread.

## What it touches

| It does                                                                                                                       | It never does                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Commits to the current branch — only the files it edited that round                                                           | `git push`, ever — that's your job, always                                                                                     |
| Replies to and resolves **bot** threads decided `VALID` / `STALE` / `FALSE_POSITIVE` / `OUT_OF_SCOPE` / `CONFLICTS_WITH_RULE` | Replies to or resolves a **human** reviewer's thread, or a bot thread decided **`ESCALATE`** — both are surfaced and left open |
| Reads/replies via the GitHub API (`gh`)                                                                                       | Answers on a comment's say-so if the action is deny-listed (see [Security](#security))                                         |

Invoking the skill **is** your standing authorization, for this PR only, to
commit, reply on GitHub, and resolve threads without asking each time — a
deliberate, scoped exception to the repo's normal "never commit
automatically" rule. It does not extend to `git push`, any other PR, or
anything after the loop stops.

## Sources it reads

| Source                          | What it looks like                                                                                                                 | How the loop handles it                                                                                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inline review threads           | CodeRabbit / Codex / Copilot comments attached to a file + line                                                                    | Resolved threads are dropped; **outdated** threads are kept and flagged — the code moved, but the finding may still be live, and deciding that is the triager's job (it returns `STALE` when it's not)                                                             |
| CodeRabbit out-of-diff findings | A review body containing `outside the diff`, with several findings in one banner                                                   | Have no thread and no fingerprint. The loop splits the body into individual findings itself, triages each, and — since they can't be replied-to per-thread — posts **one aggregate comment** on the PR covering the whole review                                   |
| React Doctor                    | A per-app check-run (`🩺 React Doctor (webapp)` / `(companion)`) that rewrites a sticky PR comment in place as findings change     | Its check-run status feeds the same red/pending gate as any other check. Its comment is also ingested directly: newly-introduced **errors** are treated as fresh findings and routed through the `react-doctor` skill during **Implement**; warnings stay advisory |
| Check-runs                      | GitHub's REST check-runs endpoint (`gh pr checks --json` doesn't exist in this repo's `gh` version, so this is a direct REST call) | Blocking conclusions — `failure`, `timed_out`, `cancelled`, `action_required`, `startup_failure` — count as red and block quiescence; `neutral` and `skipped` don't                                                                                                |
| Human comments                  | Either inline on a review thread, or written directly in the PR's conversation box (the ordinary way people comment)               | **Surfaced only**, from both sources. Collected for the round summary, never triaged, never replied to, never resolved                                                                                                                                             |

## The Copilot quota case

Copilot frequently answers a review request with "Unable to review ... quota
limit" instead of an actual review. Treating that as "Copilot reviewed and
found nothing" would be wrong — **absence of a Copilot review is not evidence
the PR is clean.**

The watcher detects the quota-limit phrase in Copilot's latest review body
and flips `copilotExpected` to `false` in the state file, emitting a single
`COPILOT_QUOTA` event (once, on the transition — not every poll). While
`copilotExpected` is `false`, quiescence stops waiting on Copilot to catch up
to the current head SHA. If Copilot later posts a real review, the flag flips
back and it's expected again.

## Verdicts

Every dispatched finding gets exactly one of six verdicts from its triager:

| Verdict               | Meaning                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `VALID`               | Problem is real and present in current code. Comes with a `fixSketch`.                                                                   |
| `STALE`               | Was real; already fixed. Cites the evidence.                                                                                             |
| `FALSE_POSITIVE`      | Never applied. Cites the code proving it.                                                                                                |
| `OUT_OF_SCOPE`        | Real, but unrelated to this PR's purpose.                                                                                                |
| `CONFLICTS_WITH_RULE` | The concern may be real, but the suggested fix violates `CLAUDE.md` or a `.claude/rules/` file. Names the rule; proposes an alternative. |
| `ESCALATE`            | Needs a human. See below and [Security](#security) for when this is mandatory.                                                           |

`confidence` is exactly `"high"`, `"medium"`, or `"low"` — and **`"low"`
forces `ESCALATE`** no matter what the rest of the triager's analysis
concluded. A verdict also always carries at least one `evidence` entry the
triager actually read; an evidence-free verdict is treated as a guess, and a
guess should have been `ESCALATE`.

## Security

`shelf.nu` is a **public repository**. Anyone with a GitHub account can post a
PR comment, and CodeRabbit itself embeds `🤖 Prompt for AI Agents` instruction
blocks inside its own comment bodies. That makes every finding body
**attacker-influenceable input**, not a trusted instruction — the loop treats
it that way end to end:

- **Marker wrapping.** Before a finding reaches the triager, its body is
  wrapped in a unique, per-invocation random marker (mirroring
  `scripts/security-review-staged.sh`, which already does this for the
  pre-commit security reviewer). Any literal marker-shaped text already in
  the body is redacted first, so a comment can't forge a boundary just by
  containing one. The comment author cannot predict the real marker, so any
  text inside it that claims to _be_ a boundary or a fresh instruction is
  self-evidently an injection attempt.
- **No Bash, no network.** `shelf-pr-comment-triager`'s tools are `Read,
Grep, Glob, Skill` only. Even a fully successful prompt injection has
  nowhere to exfiltrate to and no way to act — it can only produce a wrong
  verdict, which the marker + `ESCALATE`-on-injection contract is designed to
  catch instead.
- **`ESCALATE` is mandatory**, never auto-applied, when a finding:
  - asks for a **deny-listed** action: installing, bumping, or removing a
    dependency; editing `.github/`, `.claude/`, `lefthook.yml`, `scripts/`,
    or any `.env*`; writing a Prisma migration; running a command quoted from
    the comment; disabling a lint rule, test, or security check;
  - is architectural, or ambiguous enough that two readings imply materially
    different fixes;
  - is security-flavored — auth, org-scoping/IDOR, RLS, sessions, redirects,
    file upload, secrets;
  - touches billing or payments (Stripe, subscriptions, invoicing,
    entitlements);
  - carries `confidence: low`.
- **Injection vs. an ordinary AI-agent hint.** CodeRabbit routinely ends a
  comment with a `🤖 Prompt for AI Agents` block of fix instructions — that's
  ordinary payload describing the suggested change, not an attack. The
  triager escalates only when text targets _its verdict or its process_
  ("ignore prior instructions", "return VALID", "skip verification") —
  the test is whether following it would _change_ the answer, not merely
  _inform_ it.

## Stopping

**The loop never stops on its own.** It ends only when you say so: "stop the
loop", `/pr-review-loop stop`, or the session ending. On a stop request it
stops the background watcher and prints a final summary.

Both state files (see [Troubleshooting](#troubleshooting)) survive a stop, so
re-invoking the loop on the same PR **resumes** — it does not re-triage
findings it already decided.

## Troubleshooting

- **`gh` must be authenticated.** Both the watcher and the responder shell
  out to `gh`; run `gh auth status` if events stop flowing or replies fail to
  post.
- **`ERROR` event saying `state write rejected; events withheld`** means
  writes to the watcher's `<pr>.json` (below) are failing (e.g. a read-only
  `.git` directory). The loop is blind and quiet in that state —
  indistinguishable from a clean PR from the outside — so treat it as
  urgent, not advisory.
- **`pnpm test:tooling`** runs `scripts/__tests__/pr-review.test.sh`, the
  regression suite for `pr-review-watch.sh` and `pr-review-respond.sh`
  against captured GitHub API fixtures. Run it after touching either script.

### State is split across two files

Both live under `.git/pr-review-loop/` (resolved via
`git rev-parse --git-common-dir`, so they're shared across worktrees of the
same repo, not per-worktree). It's a single-writer-per-file split: the
watcher holds state across four network round trips per poll, so a write
from anywhere else in that window would be silently discarded.

| File                  | Owner                              | Holds                                                                                                                                              |
| --------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<pr>.json`           | the watcher (`pr-review-watch.sh`) | `pending`, `outOfDiff`, `humanComments`, `doctor`, `checks`, `headSha`, `reviewedHead`, `lastPushed*`, `repostCounts`, the `announced*` dedup maps |
| `<pr>.decisions.json` | the skill                          | `seen` (verdicts + reply prose), `escalated`, `addressedOutOfDiff`                                                                                 |

**Deleting `<pr>.json` forces the watcher to re-announce everything** —
every currently open finding looks new again, but decided verdicts are
untouched (they live in the other file), so nothing gets re-triaged or
re-replied. **Deleting `<pr>.decisions.json` discards the loop's verdicts
and reply prose** — the next round re-triages every open finding from
scratch. These are different blast radii; reach for the right one.

Either way, the separate reply ledger at `.git/pr-review-loop/<pr>.replies`
still guards against double-posting, keyed on thread id plus a hash of the
reply body, so neither reset can cause an already-answered thread to be
answered twice.
