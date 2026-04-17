---
description: Use BADGE_COLORS constants for badge styling instead of hardcoding hex values
globs: ["apps/webapp/**/*.tsx", "apps/webapp/**/*.ts"]
---

Always use `BADGE_COLORS` from `~/utils/badge-colors` when styling
Badge components. Never hardcode hex color values inline.

```typescript
// ❌ Bad
<Badge color="#E1F5FE" withDot={false}>
  <span style={{ color: "#01579B" }}>Label</span>
</Badge>

// ✅ Good
<Badge
  color={BADGE_COLORS.blue.bg}
  textColor={BADGE_COLORS.blue.text}
  withDot={false}
>
  Label
</Badge>
```
