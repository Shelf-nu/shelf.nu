---
description: Text that changes while mounted must be an element's only child, or page translation leaves the old text on screen
paths:
  - "apps/webapp/**/*.tsx"
---

# Live Text Is An Element's Only Child

Chrome's page translation replaces every text node with its own `<font>`
wrappers and detaches the original. React keeps pointing at the original, so
when that text changes React updates or removes a node that is no longer on
the page. `utils/dom-mutation-guard.ts` stops the resulting `NotFoundError`
from crashing the route, but it cannot find the translated copy: the reader
keeps seeing the old text, or the old and the new piled up side by side
("1 selected 1 selected100 selected").

This only bites text that **changes while mounted**: counters, pickers, labels
that switch with state. Text rendered once and unmounted with its parent is
safe.

**Make the changing text the element's only child, as one string.** React then
replaces the element's whole content (`textContent`), translated wrappers
included, and translation picks up the new text.

```tsx
// ❌ Bad: `{count}` and " selected" are two text nodes beside other children
<div>
  <Button … />
  {count} selected
</div>

// ✅ Good: one string, alone in its element
<div>
  <Button … />
  <span>{`${count} selected`}</span>
</div>
```

The shared `Select` already does this for the placeholder (`SelectValue`) and
for the picked option (`SelectItem` wraps the text Radix portals into the
trigger). Keep it that way.

**Test it** with `test/helpers/page-translation.ts`: render with the guard
installed, `translateTextNodes(container)`, change the state, and assert the
container holds only the new text.
