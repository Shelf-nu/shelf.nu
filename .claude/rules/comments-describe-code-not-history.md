---
description: Comments and JSDoc must describe what the code is and how to use it — never the bug, PR, or drift that prompted them
globs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]
---

# Comments Describe The Code, Not Its History

Every comment is read by someone who never saw the PR that introduced it —
usually months later, usually an agent or a colleague with no context at all.
Write for that reader: **what this thing is, what it is for, and what a caller
has to know to use it correctly.** In the present tense, as if the code had
always looked this way.

Do not narrate the fix. "Before this…", "used to…", "and duly drifted", "which
is the bug this exists to prevent", "was inverted between the apps", "this file
used to carry a copy", any phase / sprint / PR name — all of it is archaeology.
It ages instantly, it buries the sentence the reader actually needed, and it is
already recorded in the commit and the PR description.

**The test:** would this sentence still be worth reading if the bug had never
happened? If it only makes sense as an account of a fix, cut it.

| Keep — a standing constraint                                        | Cut — an incident report                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| "Read `completedAt`, never `status`: archiving rewrites the status" | "this used to read `status`, which broke on archive"       |
| "Both maps must stay visually equivalent — change one, change both" | "the two duplicated maps drifted, so we extracted this"    |
| "MISSING outranks UNEXPECTED: a missing asset may be stolen"        | "MISSING and UNEXPECTED had opposite colours between apps" |

Rationale is not the enemy — history is. Phrase a reason as a rule the next
editor must not break, not as something that once went wrong. `// why:` comments
follow the same standard: they state a standing reason, not a past incident.

```js
// ❌ Bad — a changelog entry pretending to be documentation
/**
 * Tone per audit status.
 *
 * This is the same fix already applied to the words above. Those were pulled in
 * here so the apps "can never show a different one", but the colours were left
 * duplicated and duly drifted: Pending and Active disagreed too.
 */

// ✅ Good — what it is, and the constraint on changing it
/**
 * Tone for each audit session status.
 *
 * Only a running audit (info) and a finished one (success) carry a signal; an
 * audit nobody has started yet is neutral. Audits that need chasing get a
 * separate "Overdue" badge, which is what the warning tone is reserved for.
 */
```

**Rare exception:** a comment may name a specific past failure when the code
would otherwise look wrong and be "corrected" back — a deliberate no-op, an
unusual ordering, a workaround for an upstream bug. Name the trap and why it
must stay, not the story of finding it (see
[[resolve-nullish-button-to]] for that shape done well). This is the exception,
not a licence.

**Fix the docs on code you touch.** When you edit a file and see a JSDoc or
inline comment that narrates history, restates the code, or describes behaviour
the code no longer has, rewrite it in the same change. "It was already like
that" is not a reason to leave it — every pass that ignores it makes the file
harder for the next reader. Keep the constraint, delete the archaeology, correct
anything stale.

The history still matters — it just lives in the commit message body, the PR
description, or a rule in `.claude/rules/` when it is a lesson worth enforcing
repo-wide. See [[self-improve-rules]].
