---
description: The `hidden` attribute cannot hide an element that carries a display utility, and role queries cannot see the difference
globs: ["apps/webapp/**/*.tsx", "apps/companion/**/*.tsx"]
---

# `hidden` Loses To Any Display Utility

`[hidden] { display: none }` is a base-layer rule. `flex`, `grid`, `block` and
friends are utilities, so they win: an element with both keeps rendering, at
full size, while every piece of state says it is hidden. The chevron rotates,
`aria-expanded` flips, and the panel does not move.

**No test in this repo catches it.** `getByRole` / `queryByRole` treat the
`hidden` ATTRIBUTE as removing the element from the accessibility tree, whatever
the CSS does — so an assertion that the list is gone passes against a list the
operator can still see. Typecheck and lint have nothing to say either. Only
opening the page does.

**Collapse by unmounting.** It also drops the DOM cost, which is the point when
the list is long enough to be worth folding.

```tsx
// ❌ Bad — `flex` overrides the attribute; renders on, and the test still passes
<ul hidden={!open} className="flex flex-col gap-2">

// ✅ Good — folding unmounts
{open ? <ul className="flex flex-col gap-2">…</ul> : null}

// ✅ Also good — keep the attribute for AT, toggle the display class with it
<div hidden={collapsed} className={tw(collapsed ? "hidden" : "flex flex-col")}>
```

Drop `aria-controls` while the target is unmounted; `aria-expanded` carries the
state on its own.

**Assert against the DOM, not the role query** — `document.getElementById(id)`
is `null` only when the element is really gone. A `queryByRole` assertion here
is a test that cannot fail.

Live examples: `fulfil-reservations-drawer.tsx` (unmounts) and
`team-upgrade-banner.tsx` (attribute + class).
