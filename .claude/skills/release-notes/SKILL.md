---
name: release-notes
description: Use when formatting a GitHub release for Shelf — turns GitHub's auto-generated "What's Changed" list into the house format (categorised sections, highlights, security block). Invoke for "format the release notes", "write the release notes for X", or when preparing a draft release.
---

# Shelf Release Notes

Turn GitHub's auto-generated notes into the house format. The generator gives a
flat `## What's Changed` list; the published release is **categorised**, and for
minor/major versions it opens with prose a customer can read.

**Announce at start:** "Using release-notes to format the notes for <tag>."

## Get the raw material

```bash
gh release list --repo Shelf-nu/shelf.nu --limit 5
gh release view '<tag>' --repo Shelf-nu/shelf.nu --json body,isDraft --jq .body
```

The draft body is CRLF (`\r\n`) — strip the `\r` before processing or every
regex you write will silently miss.

If there is no draft yet, generate the list rather than writing it by hand:

```bash
gh api repos/Shelf-nu/shelf.nu/releases/generate-notes \
  -f tag_name='<tag>' -f previous_tag_name='<previous-tag>' --jq .body
```

## Pick the shape

Which sections a release gets depends on what kind of release it is. Do not give
a patch release a Highlights section it does not warrant.

| Release                       | Opens with                           | Highlights                                                                   | Categories |
| ----------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- | ---------- |
| **Major** (`2.0.0`)           | `# 🚀 Shelf 2.0` + intro paragraph   | `# <emoji> <Theme>` H1 sections, one per major theme, with prose and bullets | yes        |
| **Minor** (`2.1.0`)           | `# 🚀 Shelf 2.1.0` + intro paragraph | `## 🌟 Highlights` containing `### <emoji> <Theme>` subsections              | yes        |
| **Patch** (`2.0.1`, `1.20.3`) | nothing, or `## Security release`    | none                                                                         | yes        |

Majors get expansive treatment because the audience is "what is this release
about". Patches get straight to the list.

## Categories

Always in this order. **Omit a section entirely when it has no entries** — never
emit an empty heading.

```
## 🚀 Features
## 🐛 Fixes
## ⚡ Performance
## 🔧 Refactors
## 🧹 Chores
## 📚 Documentation
## 🌱 New Contributors
```

Close with the generator's own line, unchanged:

```
**Full Changelog**: https://github.com/Shelf-nu/shelf.nu/compare/<prev-tag>...<tag>
```

### Sorting entries into categories

Use the Conventional Commit prefix, with these editorial overrides — the prefix
is a hint, not the rule:

| Prefix                 | Section       |
| ---------------------- | ------------- |
| `feat`                 | Features      |
| `fix`                  | Fixes         |
| `perf`                 | Performance   |
| `refactor`             | Refactors     |
| `chore`, `build`, `ci` | Chores        |
| `docs`                 | Documentation |

- `ci:` and `build:` go under **Chores**, not their own section.
- A `fix:` that only touches tooling or the build (a commit hook, a CI script)
  belongs under **Chores** — categorise by what it affects, not by its prefix.
- An untagged title (`Fix booking deduplication…`, `Add SCIM endpoint`) is sorted
  by reading it. Keep the title exactly as written; do not retro-fit a prefix.
- Dependabot bumps are Chores.

### Entry format — keep it verbatim

```
* <PR title> by @<author> in https://github.com/Shelf-nu/shelf.nu/pull/<n>
```

This is the generator's own format. **Do not** rewrite titles, shorten URLs,
convert them to `#1234`, or re-order within a section — the order the generator
produced is merge order and is worth preserving. Reformatting is about grouping,
not rewording.

Preserve `@dependabot[bot]` exactly, brackets included.

## The security block

When the release contains a security fix, it goes **first**, before everything
else, and before any `# Shelf X.Y` title if the release has one.

```markdown
## Security release

This release contains a **security fix** for [GHSA-xxxx-xxxx-xxxx](https://github.com/Shelf-nu/shelf.nu/security/advisories/GHSA-xxxx-xxxx-xxxx) — <one sentence: the vulnerability class and what an attacker could do>. Severity: **High** (CVSS 7.1).

**Affected versions:** all versions prior to `<version>`.

**All self-hosted operators should upgrade immediately.**
```

Rules for this block:

- **Draft the advisories first, then link them.** The release and the advisories
  ship together — see "Creating the advisories" below. Draft GHSAs get their id
  at creation, so the release notes can link them before either is published.
  Never invent an id or link a placeholder.

- Link by id in the usual form:
  `[GHSA-xxxx-xxxx-xxxx](https://github.com/Shelf-nu/shelf.nu/security/advisories/GHSA-xxxx-xxxx-xxxx)`.

- **List the highest severity first** — that is the one driving upgrade urgency.

- State the blast radius honestly, including what it does NOT reach — e.g.
  "neither issue crosses an organization boundary; both are limited to members of
  the same workspace, with no escalation to Admin or Owner". Operators judge
  urgency on scope, and understating it is as unhelpful as overstating it.

- More than one issue in a release: use a bullet per issue with its own severity
  and CVSS rather than cramming them into one sentence.
- One sentence on the vulnerability class (IDOR, SSRF, broken access control)
  and its impact. Enough for an operator to judge urgency; not a reproduction.
  The exploit detail belongs in the advisory, not the release notes.
- State severity and CVSS when known.
- Give the affected range precisely. `1.20.1` used
  ``**Affected versions:** `1.12` through `1.20.0`. Versions `1.11.5` and earlier
are not affected.`` — prefer that specificity over "all prior versions" when
  the range is genuinely bounded.
- Credit an external reporter by profile link, e.g.
  `Reported by https://github.com/KennethWussmann — thank you.`
- Add an upgrade snippet when the upgrade is not obvious:

  ````markdown
  ### Upgrade

  ```bash
  docker pull ghcr.io/shelf-nu/shelf.nu:<version>
  # or, if you track :latest
  docker pull ghcr.io/shelf-nu/shelf.nu:latest
  ```

  Then restart your container. No database migration is required.
  ````

  Say whether a migration is required — operators need that either way. If a
  migration IS required, say so explicitly rather than omitting the sentence.

## Creating the advisories

Do this **before** finalising the security block, so the notes can link real ids.
Drafts are private until published, so creating them early costs nothing.

Match the existing advisories rather than inventing a shape — read one first:

```bash
gh api repos/Shelf-nu/shelf.nu/security-advisories --jq '.[] | "\(.ghsa_id) \(.state) \(.severity) — \(.summary)"'
gh api repos/Shelf-nu/shelf.nu/security-advisories/<GHSA-ID> --jq .description
```

The house description uses exactly these headings:

```
### Summary
### Details
### Impact
### Patches
### Workarounds
### References
```

- **Summary** — what the roles involved could do, and one sentence bounding the
  scope ("confined to a single workspace… no cross-tenant access and no
  escalation to Admin or Owner").
- **Details** — this is where the reproduction detail belongs, not in the release
  notes. Enumerate the distinct paths; a bullet each.
- **Impact** — confidentiality vs integrity, stated plainly.
- **Patches** — the fixed version and what changed conceptually.
- **Workarounds** — say "None short of upgrading" when that is the truth, and
  name any partial mitigation.
- **References** — the PR links.

Create with the REST API, one JSON file per advisory:

```bash
gh api --method POST repos/Shelf-nu/shelf.nu/security-advisories --input adv.json \
  --jq '{ghsa_id, state, severity, cvss: .cvss.score, html_url}'
```

```jsonc
{
  "summary": "<one line, vulnerability class in parentheses>",
  "description": "<the markdown above>",
  "cvss_vector_string": "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N",
  "cwe_ids": ["CWE-200", "CWE-863"],
  "vulnerabilities": [
    {
      "package": { "ecosystem": "other", "name": "shelf.nu" },
      "vulnerable_version_range": "<= 2.1.0",
      "patched_versions": "2.1.1"
    }
  ]
}
```

Gotchas that cost a round trip:

- **Do not send both `severity` and `cvss_vector_string`** — the API rejects it
  with a 422. Send the vector; the severity and score are derived from it.
- `vulnerable_version_range` is the LAST affected version (`<= 2.1.0`), not the
  patched one.
- Typical CWEs here: `CWE-200`/`CWE-863` for disclosure, `CWE-862`/`CWE-639` for
  a missing or bypassable authorization check.
- Score honestly. `C:H` is warranted when personal data (emails, billing ids)
  is exposed, not merely for a name; an unauthorized state change is `I:H`
  rather than `C:H`.

**Publishing is the user's call, for both the release and the advisories.**
Create them as drafts and stop.

## Highlights (minor and major only)

Highlights are written, not generated. Read the Features list and group it into
2–5 themes a customer would recognise — not a restatement of the PR titles.

Minor release:

```markdown
## 🌟 Highlights

### 📦 Smarter Quantity

Take even greater control over quantity-tracked assets with new inventory
management capabilities.

Highlights include:

- Low-stock alerting
- Improved quantity locking to prevent race conditions
```

Themes seen so far, with their emoji — reuse these when the theme recurs so
releases stay recognisable: 📦 quantity/inventory, 📱 Companion app,
🔐 Enterprise/SSO/SCIM, 📅 user preferences, 📊 reporting.

Separate the intro, the Highlights block, and the categorised list with `---`.

Write for someone deciding whether to upgrade. No PR numbers, no file paths, no
internal shorthand.

## Assembling

Write the body to a file and publish from it — never pass a multi-hundred-line
body as a shell argument.

```bash
gh release edit '<tag>' --repo Shelf-nu/shelf.nu \
  --notes-file "<scratchpad>/release-notes.md"
```

Keep the release a **draft** unless asked otherwise. Publishing is the user's
call — it notifies watchers and, for a security release, starts the disclosure
clock.

Show the user the assembled markdown before writing it to the release.

## Checklist

- [ ] `\r` stripped from the generated body
- [ ] Every PR from the raw list appears exactly once — count them before and
      after; a dropped entry is the failure mode this format invites
- [ ] Sections in the canonical order, empty ones omitted
- [ ] Entry lines byte-identical to the generator's
- [ ] `**Full Changelog**` line present and pointing at the right compare range
- [ ] Security block first, severity and affected range stated, blast radius
      bounded — and either a real GHSA link or the "will be published shortly"
      line, never a placeholder id in a published release
- [ ] Highlights only on minor/major, and written as prose rather than
      re-listed PR titles
