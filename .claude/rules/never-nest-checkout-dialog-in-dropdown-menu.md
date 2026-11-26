---
description: Never render a dialog (CheckoutDialog, CheckinDialog, anything with pickers) inside a DropdownMenuItem; render it beside the menu, controlled, and open it from the row.
paths:
  - "apps/webapp/app/components/**/*.tsx"
  - "apps/webapp/app/routes/**/*.tsx"
---

# Never Put A Dialog Inside A `DropdownMenuItem`

A dialog inside a menu row breaks two ways. The menu closes when a row is
picked (desktop sheet menus included), which unmounts the dialog with it. And
React bubbles the portaled dialog's events through the row, which takes focus
on every mouse move, so a picker inside it closes before an option is chosen.

Render the dialog beside the menu, controlled (`open`, `onOpenChange`,
`returnFocusTo`), and open it from the row. Enter and Space reach the row's
button (see `DropdownMenuItem`), so its `onClick` or the item's `onSelect` both work:

```tsx
// ❌ Bad
<DropdownMenuItem><CheckinDialog booking={booking} /></DropdownMenuItem>

// ✅ Good
<CheckinDialog booking={booking} open={open} onOpenChange={setOpen}
  returnFocusTo={() => triggerRef.current} />
<DropdownMenuItem onSelect={(e) => { e.preventDefault(); setOpen(true); closeMenu(); }}>
```

See `checkout-dropdown.tsx` and `checkin-dropdown.tsx`; pinned by their tests.
