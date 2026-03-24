# Auto-Update Website Documentation from App PRs

**Date:** 2026-03-24
**Status:** Draft
**Scope:** Cross-repo automation between `Shelf-nu/shelf.nu` and `Shelf-nu/website-v2`

---

## Problem

Shelf's website (`website-v2`) contains knowledge-base articles and changelogs
written in MDX. There is no CMS. When features ship via PRs merged to `shelf.nu`,
the website docs often lag behind because updating them is a separate manual
process. There is no automated link between shipping code and updating docs.

## Solution

An automated pipeline that detects docs-worthy PRs merged to `shelf.nu`,
analyzes them with Claude, and opens a PR on `website-v2` with the
appropriate knowledge-base or changelog updates. A human reviewer approves
or rejects every generated PR — Claude never publishes directly.

---

## Architecture Overview

```
shelf.nu: PR merged to main
         │
         ▼
   deploy.yml (existing)
         │
         ▼  deploy succeeds (main only)
         │
   ┌─────┴─────────────────────────┐
   │  New job: update-docs         │
   │                               │
   │  1. Find merged PR metadata   │
   │  2. Gate 1: label/prefix      │
   │     └─ No match → stop        │
   │  3. Fire repository_dispatch  │
   │     to website-v2             │
   └───────────────┬───────────────┘
                   │
                   ▼
   ┌───────────────────────────────┐
   │  website-v2:                  │
   │  update-docs-from-app.yml     │
   │                               │
   │  Job 1: classify              │
   │  4. Fetch PR details from     │
   │     shelf.nu (public API)     │
   │  5. Gate 2: Haiku classifier  │
   │     └─ No impact → stop       │
   │                               │
   │  Job 2: update-docs           │
   │  6. Claude analyzes PR diff   │
   │  7. Claude reads existing     │
   │     website content           │
   │  8. Claude writes/updates MDX │
   │     on a new branch           │
   │  9. Open PR, assign reviewer  │
   └───────────────────────────────┘
```

---

## Filtering: Three-Layer Gate

Most merged PRs do not need docs updates. The filtering pipeline avoids
wasting compute on irrelevant PRs while catching meaningful changes.

### Gate 1: Label or Prefix (shelf.nu — free, instant)

A shell conditional in the `update-docs` job. The PR qualifies if **either**:

- It has the `docs-impact` label, **OR**
- Its title starts with `feat:`, `feat!:`, or `feat(<scope>):` (conventional
  commits prefix, including breaking changes and scoped features)

If neither condition is met, the job exits without dispatching. This gate is
intentionally loose — it casts a wide net that Gate 2 narrows.

**Why both signals?** Labels require developer intent (opt-in). The `feat:`
prefix catches feature PRs where the developer forgot to label. Together they
cover the common cases without requiring process discipline.

### Gate 2: Haiku Classifier (website-v2 — cheap, smart)

Runs in the `classify` job on `website-v2` after receiving the dispatch. Uses
`claude-code-action` with Haiku model and structured output.

**Input context** (passed via `client_payload` + fetched from public API):

- PR title
- PR description/body
- Labels
- Changed file paths

**NOT included:** The full diff. Haiku only needs to classify, not understand
implementation details. This keeps the call fast and cheap.

**Output schema:**

```json
{
  "type": "object",
  "properties": {
    "needs_docs_update": {
      "type": "boolean",
      "description": "Whether this PR warrants a website documentation update"
    },
    "reason": {
      "type": "string",
      "description": "Brief explanation of why docs do or do not need updating"
    },
    "update_type": {
      "type": "string",
      "enum": ["knowledge_base", "changelog", "both", "none"],
      "description": "What type of content should be created or updated"
    },
    "suggested_scope": {
      "type": "string",
      "description": "Brief description of what docs should cover"
    }
  },
  "required": ["needs_docs_update", "reason", "update_type"]
}
```

**Classification prompt** (condensed):

```
You are a documentation triage classifier for Shelf.nu, an asset management
platform. Given a merged PR's metadata, determine if the website documentation
needs updating.

Answer "needs_docs_update": true when:
- A new user-facing feature was added
- Existing user-facing behavior changed in a way users would notice
- New configuration options, settings, or permissions were added
- A workflow or UI flow was significantly altered

Answer "needs_docs_update": false when:
- The change is purely internal (refactoring, performance, dev tooling)
- Only tests, CI, or build configuration changed
- The change is a bug fix that restores expected behavior (no docs change)
- Dependencies were updated with no user-facing impact

PR Data:
{pr_title, pr_body, pr_labels, pr_changed_files}
```

If `needs_docs_update` is `false`, the workflow stops. No Claude session runs.

### Gate 3: Human Review (the PR itself)

Claude opens a PR. A team member reviews it. This is the final gate before
anything reaches production. The reviewer can:

- Merge as-is
- Edit and merge
- Close with no action
- Comment with feedback (Claude responds via `@claude` on the PR if desired)

---

## Workflow 1: shelf.nu — `deploy.yml` Modification

### New job: `update-docs`

Added to the existing `deploy.yml`. Runs after the `deploy` job succeeds,
only on `main` branch pushes.

```yaml
update-docs:
  name: 📝 Update Website Docs
  runs-on: ubuntu-latest
  needs: [deploy]
  if: ${{ github.ref == 'refs/heads/main' }}
  steps:
    - name: ⬇️ Checkout repo
      uses: actions/checkout@v4

    - name: 🔍 Find merged PR
      id: find_pr
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      run: |
        # Use the commits-to-PR association API (reliable, unlike search)
        PR_JSON=$(gh api \
          "repos/${{ github.repository }}/commits/${{ github.sha }}/pulls" \
          --jq '.[0] // empty')

        if [ -z "$PR_JSON" ] || [ "$PR_JSON" = "null" ]; then
          echo "No merged PR found for this commit. Skipping."
          echo "eligible=false" >> "$GITHUB_OUTPUT"
          exit 0
        fi

        PR_NUMBER=$(echo "$PR_JSON" | jq -r '.number')
        PR_TITLE=$(echo "$PR_JSON" | jq -r '.title')
        HAS_DOCS_LABEL=$(echo "$PR_JSON" | jq '[.labels[]?.name] | any(. == "docs-impact")')

        if [ -z "$PR_NUMBER" ]; then
          echo "No merged PR found for this commit. Skipping."
          echo "eligible=false" >> "$GITHUB_OUTPUT"
          exit 0
        fi

        echo "number=$PR_NUMBER" >> "$GITHUB_OUTPUT"
        echo "title=$PR_TITLE" >> "$GITHUB_OUTPUT"
        echo "has_docs_label=$HAS_DOCS_LABEL" >> "$GITHUB_OUTPUT"

    - name: 🚦 Check docs eligibility (Gate 1)
      id: gate
      if: ${{ steps.find_pr.outputs.number != '' }}
      run: |
        HAS_LABEL="${{ steps.find_pr.outputs.has_docs_label }}"

        # Write title to file to avoid shell injection from PR titles
        cat <<'TITLE_EOF' > /tmp/pr_title.txt
        ${{ steps.find_pr.outputs.title }}
        TITLE_EOF

        # Check for feat: prefix including feat!: and feat(scope):
        HAS_FEAT_PREFIX=false
        if grep -iq '^[[:space:]]*feat[(!:]' /tmp/pr_title.txt; then
          HAS_FEAT_PREFIX=true
        fi

        if [[ "$HAS_LABEL" == "true" || "$HAS_FEAT_PREFIX" == "true" ]]; then
          echo "eligible=true" >> "$GITHUB_OUTPUT"
          echo "✅ PR qualifies: label=$HAS_LABEL, feat_prefix=$HAS_FEAT_PREFIX"
        else
          echo "eligible=false" >> "$GITHUB_OUTPUT"
          echo "⏭️ PR does not qualify. Skipping."
        fi

    - name: 🚀 Dispatch to website-v2
      if: ${{ steps.gate.outputs.eligible == 'true' }}
      env:
        GH_TOKEN: ${{ secrets.WEBSITE_DISPATCH_TOKEN }}
      run: |
        gh api repos/Shelf-nu/website-v2/dispatches \
          --input - <<EOF
        {
          "event_type": "update-docs",
          "client_payload": {
            "pr_number": ${{ steps.find_pr.outputs.number }},
            "source_repo": "${{ github.repository }}"
          }
        }
        EOF
        echo "📤 Dispatched update-docs to website-v2"
```

**Design decisions:**

- **Only `pr_number` and `source_repo` in the payload.** The website-v2
  workflow fetches full PR details itself. This avoids JSON escaping issues
  with PR bodies containing special characters, and ensures Claude always
  sees the latest PR state.
- **`WEBSITE_DISPATCH_TOKEN`** is a fine-grained PAT with `contents:write`
  scope on `Shelf-nu/website-v2`. Required because `GITHUB_TOKEN` cannot
  trigger workflows in other repos.

---

## Workflow 2: website-v2 — `update-docs-from-app.yml` (New)

```yaml
name: 📝 Update Docs from App PR

on:
  repository_dispatch:
    types: [update-docs]

concurrency:
  group: update-docs-${{ github.event.client_payload.pr_number }}
  cancel-in-progress: true

permissions:
  contents: write
  pull-requests: write

jobs:
  classify:
    name: 🔍 Classify docs impact
    runs-on: ubuntu-latest
    outputs:
      needs_update: ${{ steps.parse.outputs.needs_update }}
      update_type: ${{ steps.parse.outputs.update_type }}
      suggested_scope: ${{ steps.parse.outputs.suggested_scope }}
      reason: ${{ steps.parse.outputs.reason }}
    steps:
      - name: ⬇️ Checkout website
        uses: actions/checkout@v4

      - name: 🔍 Fetch PR details from app repo
        id: pr_details
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          SOURCE_REPO="${{ github.event.client_payload.source_repo }}"
          PR_NUMBER="${{ github.event.client_payload.pr_number }}"

          PR_JSON=$(gh pr view "$PR_NUMBER" \
            --repo "$SOURCE_REPO" \
            --json title,body,labels,files)

          # Write to file to avoid shell escaping issues
          echo "$PR_JSON" > /tmp/pr_data.json

          # Also extract individual fields for logging
          TITLE=$(echo "$PR_JSON" | jq -r '.title')
          echo "📋 Classifying PR #$PR_NUMBER: $TITLE"

      - name: 🤖 Classify with Haiku (Gate 2)
        id: classify
        uses: anthropics/claude-code-action@v1
        with:
          prompt: |
            Read the PR data from /tmp/pr_data.json and classify whether
            this merged PR to Shelf.nu (an asset management platform)
            requires documentation updates on the marketing website.

            Answer needs_docs_update=true when:
            - A new user-facing feature was added
            - Existing user-facing behavior changed noticeably
            - New settings, permissions, or configuration options were added
            - A workflow or UI flow was significantly altered

            Answer needs_docs_update=false when:
            - Internal-only changes (refactoring, performance, dev tooling)
            - Test/CI/build changes only
            - Bug fixes restoring expected behavior
            - Dependency updates with no user-facing impact
          claude_args: >-
            --model claude-haiku-4-5-20251001
            --json-schema '{"type":"object","properties":{"needs_docs_update":{"type":"boolean"},"reason":{"type":"string"},"update_type":{"type":"string","enum":["knowledge_base","changelog","both","none"]},"suggested_scope":{"type":"string"}},"required":["needs_docs_update","reason","update_type"]}'
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}

      - name: 📊 Parse classification result
        id: parse
        run: |
          # Write to file to avoid shell injection from structured output
          cat <<'CLASSIFY_EOF' > /tmp/classify_result.json
          ${{ steps.classify.outputs.structured_output }}
          CLASSIFY_EOF

          # Validate JSON before parsing
          if ! jq empty /tmp/classify_result.json 2>/dev/null; then
            echo "❌ Classification returned invalid JSON. Defaulting to skip."
            echo "needs_update=false" >> "$GITHUB_OUTPUT"
            echo "update_type=none" >> "$GITHUB_OUTPUT"
            echo "reason=Classification failed - invalid output" >> "$GITHUB_OUTPUT"
            echo "suggested_scope=" >> "$GITHUB_OUTPUT"
            exit 0
          fi

          NEEDS_UPDATE=$(jq -r '.needs_docs_update' /tmp/classify_result.json)
          UPDATE_TYPE=$(jq -r '.update_type' /tmp/classify_result.json)
          REASON=$(jq -r '.reason' /tmp/classify_result.json)
          SCOPE=$(jq -r '.suggested_scope // empty' /tmp/classify_result.json)

          echo "needs_update=$NEEDS_UPDATE" >> "$GITHUB_OUTPUT"
          echo "update_type=$UPDATE_TYPE" >> "$GITHUB_OUTPUT"
          echo "reason=$REASON" >> "$GITHUB_OUTPUT"
          echo "suggested_scope=$SCOPE" >> "$GITHUB_OUTPUT"

          if [ "$NEEDS_UPDATE" = "true" ]; then
            echo "✅ Docs update needed: $REASON"
          else
            echo "⏭️ No docs update needed: $REASON"
          fi

  update-docs:
    name: 📝 Generate docs update
    needs: classify
    if: ${{ needs.classify.outputs.needs_update == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - name: ⬇️ Checkout website
        uses: actions/checkout@v4

      - name: 🌿 Create branch for docs update
        id: branch
        run: |
          PR_NUMBER="${{ github.event.client_payload.pr_number }}"
          BRANCH="docs/app-pr-${PR_NUMBER}"
          git checkout -b "$BRANCH"
          echo "name=$BRANCH" >> "$GITHUB_OUTPUT"

      - name: 🤖 Generate docs with Claude
        id: claude
        uses: anthropics/claude-code-action@v1
        env:
          CLAUDE_BRANCH: ${{ steps.branch.outputs.name }}
        with:
          prompt: |
            You have a skill file at .claude/skills/docs-update-from-pr.md.
            Read it and follow its instructions.

            Context:
            - Source repo: ${{ github.event.client_payload.source_repo }}
            - PR number: ${{ github.event.client_payload.pr_number }}
            - Classification: ${{ needs.classify.outputs.update_type }}
            - Suggested scope: ${{ needs.classify.outputs.suggested_scope }}
            - Classifier reason: ${{ needs.classify.outputs.reason }}

            IMPORTANT: You are already on branch "${{ steps.branch.outputs.name }}".
            Do NOT create a new branch. Make your changes, commit, and push
            to this branch.
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}

      - name: 🔍 Check if Claude made changes
        id: changes
        run: |
          BRANCH="${{ steps.branch.outputs.name }}"
          # Check if the branch has commits ahead of main
          AHEAD=$(git rev-list --count main.."$BRANCH" 2>/dev/null || echo "0")
          if [ "$AHEAD" -gt 0 ]; then
            echo "has_changes=true" >> "$GITHUB_OUTPUT"
          else
            echo "has_changes=false" >> "$GITHUB_OUTPUT"
            echo "⏭️ Claude made no changes. Skipping PR creation."
          fi

      - name: 📬 Create PR
        if: ${{ steps.changes.outputs.has_changes == 'true' }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          SOURCE_REPO="${{ github.event.client_payload.source_repo }}"
          PR_NUMBER="${{ github.event.client_payload.pr_number }}"
          BRANCH="${{ steps.branch.outputs.name }}"
          REVIEWER="${{ vars.DOCS_REVIEWER }}"
          UPDATE_TYPE="${{ needs.classify.outputs.update_type }}"
          REASON="${{ needs.classify.outputs.reason }}"

          # Fetch source PR title for the docs PR title
          SOURCE_TITLE=$(gh pr view "$PR_NUMBER" \
            --repo "$SOURCE_REPO" \
            --json title --jq '.title')

          # Push the branch
          git push origin "$BRANCH"

          # Build PR body safely using a temp file
          cat > /tmp/pr_body.md <<PRBODY
## Auto-generated docs update

**Source PR:** ${SOURCE_REPO}#${PR_NUMBER}
**Update type:** ${UPDATE_TYPE}
**Why:** ${REASON}

---

This PR was automatically generated by Claude after a feature PR
was merged to the app repo. Please review the content changes for
accuracy and tone before merging.

> To request changes from Claude, comment \`@claude <your feedback>\`
> on this PR.
PRBODY

          gh pr create \
            --base main \
            --head "$BRANCH" \
            --title "docs: update from ${SOURCE_REPO}#${PR_NUMBER}" \
            --reviewer "$REVIEWER" \
            --body-file /tmp/pr_body.md

          echo "✅ PR created and reviewer set to $REVIEWER"
```

---

## The Skill: `.claude/skills/docs-update-from-pr.md`

Lives in the `website-v2` repo. This is the core prompt that determines the
quality of generated documentation. It will need iteration over time.

**Location:** `Shelf-nu/website-v2/.claude/skills/docs-update-from-pr.md`

### Skill Content (draft)

```markdown
---
name: docs-update-from-pr
description: >
  Analyze a merged PR from the Shelf.nu app repo and create or update
  documentation on the website. Covers knowledge-base articles and
  changelog entries.
---

# Update Website Docs from App PR

You are updating the Shelf.nu website documentation based on a PR that was
just merged to the main app repository.

## Your Mission

1. Understand what changed in the app (user-facing impact)
2. Determine which existing docs are affected
3. Create or update the appropriate MDX content
4. Commit your changes with a clear message

## Step 1: Fetch the PR

Use the `gh` CLI to fetch full PR details and diff from the public repo:

    gh pr view <PR_NUMBER> --repo <SOURCE_REPO> --json title,body,labels,files
    gh pr diff <PR_NUMBER> --repo <SOURCE_REPO>

Read the diff carefully. Focus on:

- Route changes (new pages, changed URLs, new form fields)
- Schema changes (new models, new fields users interact with)
- UI changes (new components in routes, changed user flows)
- Permission/role changes
- New configuration or settings

## Step 2: Survey Existing Content

Before writing anything, understand what already exists:

- List all files in `content/knowledge-base/` and read their frontmatter
- List all files in `content/updates/` and read their frontmatter
- Search for keywords related to the PR's feature area
- Identify articles that cover the same or adjacent topics

## Step 3: Decide What to Write

Based on the classification context provided and your analysis:

### Knowledge-base article (content/knowledge-base/)

**Update an existing article when:**

- The PR adds a new option, field, or behavior to an existing feature
- The PR changes how an existing documented workflow works

**Create a new article when:**

- The PR introduces an entirely new feature with no existing coverage
- The feature is significant enough to warrant standalone documentation

### Changelog entry (content/updates/)

**Create a changelog entry when:**

- A user-visible feature or improvement shipped
- Keep it concise: what changed and why users should care

## Step 4: Write the Content

### MDX Format

All content files use MDX with YAML frontmatter:

    ---
    title: "Article Title"
    description: "Brief description for SEO and previews"
    category: "optional category"
    ---

    Content in MDX format...

### Content Guidelines

- **Voice:** Practical, helpful, second-person ("you can...", "to do X...")
- **Structure:** Lead with what the feature does, then how to use it
- **Formatting:** Use headings (##, ###), bullet lists, and code blocks
- **Length:** Knowledge-base articles: 200-800 words. Changelogs: 50-200 words.
- **Accuracy:** Only document what you can verify from the PR diff. If you
  cannot determine exact UI labels or button text from the code, describe the
  functionality and add a TODO comment for the reviewer.
- **No speculation:** Do not invent features, UI elements, or workflows that
  are not evident in the PR diff.

### File Naming

- Knowledge-base: `content/knowledge-base/<slug>.mdx` — use kebab-case,
  descriptive slug matching the article topic
- Changelog: `content/updates/<feature-slug>.mdx` — use the feature name
  as the slug. If a file with that slug already exists, disambiguate by
  appending the PR number (e.g., `feature-slug-2345.mdx`)

Look at existing files for conventions. Match what is already there.

## Step 5: Commit and Push

You are already on a branch (provided in your prompt context). Do NOT create
a new branch. Stage your changes, commit, and push:

    git add <files you created or modified>
    git commit -m "docs: <brief description>

    Based on <source_repo>#<pr_number>"
    git push origin HEAD

## Important Rules

- **DO NOT** modify `content/features/` pages (marketing content, out of scope)
- **DO NOT** create `content/blog/` posts (editorial content, out of scope)
- **DO NOT** change site configuration, navigation, or layout files
- **DO NOT** modify existing content that is unrelated to the PR
- **DO** add TODO comments (<!-- TODO: ... -->) for anything you are unsure
  about — the reviewer will resolve these
- **DO** reference the source PR number in your content where appropriate
- If you genuinely cannot determine what docs to write, create a minimal
  changelog entry describing the change and add a TODO for the reviewer
  to expand it
```

---

## Authentication and Secrets

### shelf.nu repo secrets

| Secret                   | Value            | Purpose                                                                                                  |
| ------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------- |
| `WEBSITE_DISPATCH_TOKEN` | Fine-grained PAT | Trigger `repository_dispatch` on `website-v2`. Requires `contents:write` scope on `Shelf-nu/website-v2`. |

**Note:** All other secrets in `deploy.yml` already exist. No Anthropic auth
is needed in shelf.nu — the classification runs in website-v2.

### website-v2 repo secrets and variables

| Secret/Variable           | Type     | Value                     | Purpose                                                                                              |
| ------------------------- | -------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Secret   | From `claude setup-token` | Authenticates Claude Code with Max plan. Used for both Haiku classification and full Claude session. |
| `DOCS_REVIEWER`           | Variable | GitHub username           | Assigned as PR reviewer. Configurable via repo settings without code changes.                        |

### Token Generation

Generate the OAuth token locally:

```bash
claude setup-token
```

Store the output as a GitHub Actions secret named `CLAUDE_CODE_OAUTH_TOKEN`
in the `website-v2` repo settings.

**Known risk:** Token expiration is undocumented. If the workflow starts
failing on auth, regenerate the token. Consider adding a monitoring alert
or periodic token refresh workflow.

### Cross-Repo Access Assumption

Both `Shelf-nu/shelf.nu` and `Shelf-nu/website-v2` are **public** repos. The
website-v2 workflow uses its default `GITHUB_TOKEN` to read PR data from
shelf.nu via `gh pr view` — this works because the source repo is public. If
shelf.nu ever becomes private, a PAT with cross-repo read access would be
needed in website-v2 as well.

### Model Availability Note

The Haiku classification step uses `--model claude-haiku-4-5-20251001` via
`claude_args`. Model availability may depend on the plan backing the OAuth
token. If the specific model ID changes or becomes unavailable, update the
workflow to use the current Haiku model ID.

---

## Concurrency and Edge Cases

### Agent mode and branch creation

`claude-code-action` in agent mode (triggered by `repository_dispatch` with
a `prompt`) does NOT automatically create branches — `branch_name_template`
only works in tag/interactive mode. The workflow handles this by creating the
branch in a shell step before Claude runs, and passing the branch name via
the `CLAUDE_BRANCH` env var and the prompt itself. Claude commits and pushes
to this pre-created branch.

### Multiple PRs merging in sequence

Each dispatch carries a unique `pr_number`. The concurrency group
`update-docs-${{ github.event.client_payload.pr_number }}` ensures that
duplicate dispatches for the same PR cancel previous runs, while different
PRs run independently (or queue if runner capacity is limited).

Branch names include the PR number (`docs/app-pr-<number>`), so there are
no branch conflicts between concurrent runs.

### PR with no user-facing changes passes Gate 1

Gate 2 (Haiku) catches it. If Haiku also misclassifies, the human reviewer
closes the PR. Three layers of defense, with the cheapest layers first.

### Claude cannot determine what to write

The skill instructs Claude to create a minimal changelog entry with TODO
comments rather than silently skipping. A PR with TODOs is more useful than
no PR at all — the reviewer can flesh it out or close it.

### Stale content on website-v2

Claude always works against the latest `main` of website-v2 (fresh checkout).
Content drift between shelf.nu shipping and the docs PR being created is
negligible (minutes).

### False negatives: docs-worthy PR without `feat:` or label

Acceptable. Developers can manually add the `docs-impact` label before or
after merge. A missed PR can also be handled manually. Perfect recall is not
the goal — reducing manual toil for the common case is.

### OAuth token expiration

If the token expires mid-workflow, both the classify and update-docs jobs
will fail. The workflow should have clear error messages. Future improvement:
add a scheduled workflow that validates the token periodically.

---

## Cost Analysis

**Haiku classification per PR:** ~500 input tokens, ~100 output tokens.
Effectively free under Max plan.

**Full Claude session per qualifying PR:** Depends on PR complexity and
existing content volume. Estimated 10k-50k tokens per run. Under Max plan
with existing usage headroom, this adds negligible load.

**GitHub Actions minutes:** ~2-5 minutes per full run (classify + update).
Ubuntu runners are free for public repos.

**Expected volume:** With the `feat:` + label gate, roughly 2-10 PRs per
week qualify for classification. Of those, Haiku will likely pass 1-5
through to the full Claude session.

---

## Future Improvements (Out of Scope for v1)

- **Periodic catch-up job:** Scheduled workflow that scans recent shelf.nu
  PRs for any that were missed by the gate filters
- **Screenshot automation:** Capture UI screenshots for knowledge-base
  articles using Playwright in CI
- **Monorepo consolidation:** When website-v2 moves into the Turborepo
  monorepo, simplify to a single workflow (no cross-repo dispatch needed)
- **Feedback loop:** Track which generated PRs get merged vs closed to
  tune the classification prompt and skill over time
- **Batched changelogs:** Aggregate multiple small changes into weekly
  changelog entries instead of one per PR

---

## Implementation Order

1. **Create the `docs-impact` label** on `shelf.nu` repo
2. **Add `WEBSITE_DISPATCH_TOKEN` secret** to `shelf.nu` repo
3. **Generate and store `CLAUDE_CODE_OAUTH_TOKEN`** in `website-v2`
4. **Set `DOCS_REVIEWER` variable** in `website-v2`
5. **Create the skill file** in `website-v2` at
   `.claude/skills/docs-update-from-pr.md`
6. **Create the workflow** in `website-v2` at
   `.github/workflows/update-docs-from-app.yml`
7. **Modify `deploy.yml`** in `shelf.nu` — add the `update-docs` job
8. **Test end-to-end** with a real `feat:` PR merged to shelf.nu main
9. **Iterate on the skill prompt** based on the quality of first few
   generated PRs
