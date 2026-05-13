---
description: Use the useAutoFocus hook instead of the autoFocus JSX prop
globs: ["apps/webapp/**/*.tsx"]
---

`jsx-a11y/no-autofocus` disallows the `autoFocus` prop. When you need
intentional focus on mount (modals, form dialogs, search boxes) reach
for the shared `useAutoFocus` hook at
`apps/webapp/app/hooks/use-auto-focus.ts` — do NOT hand-roll the
`useRef + useEffect(focus, [])` pattern. The hook already:

- Defers focus to the next animation frame (Radix portals mount on
  next tick — without this, the ref is still `null` when the effect
  fires).
- Re-focuses when a `when` flag flips false → true (modal open).
- Returns a `RefObject<T | null>` you pass straight to the input.

```tsx
// ❌ Bad — fires before Radix portal mounts; misses focus
<Input autoFocus name="quantity" />;

// ❌ Bad — duplicates what the hook already does
const ref = useRef<HTMLInputElement>(null);
useEffect(() => {
  if (open) ref.current?.focus();
}, [open]);
<Input ref={ref} name="quantity" />;

// ✅ Good — re-focuses on each closed → open flip
const ref = useAutoFocus<HTMLInputElement>({ when: open });
<Input ref={ref} name="quantity" />;

// ✅ Good — focus once on mount (no `when` gate needed)
const ref = useAutoFocus<HTMLInputElement>();
<Input ref={ref} name="name" />;
```
