---
description: When you discover a new reusable coding pattern or receive feedback about how to write code in this project, create a new rule file in .claude/rules/
globs: ["**/*"]
---

When you notice a new pattern that should be standardized across the
codebase — either from user feedback, code review corrections, or
repeated implementations — create a new rule file in `.claude/rules/`.

Each rule file should:

- Have a descriptive filename (e.g., `use-badge-colors.md`)
- Include `description` and `globs` frontmatter
- Show a ❌ Bad / ✅ Good code example where applicable
- Be concise (under 30 lines)

Only create rules for patterns that:

- Apply to all contributors (not user-specific preferences)
- Are not already covered in CLAUDE.md
- Would prevent real mistakes if forgotten

Do NOT create rules for one-off fixes or ephemeral context.
