---
description: Never render CheckoutDialog (or any dialog with selects or pickers) inside a DropdownMenu; open it from the menu row and render it beside the menu.
paths:
  - "apps/webapp/app/components/**/*.tsx"
  - "apps/webapp/app/routes/**/*.tsx"
---

# Never Put `CheckoutDialog` Inside A `DropdownMenu`

React bubbles a portaled dialog's events through its component parents, and a
Radix `DropdownMenuItem` takes focus on every mouse move it sees. Inside a menu
item, the dialog's "From location" picker loses focus as the mouse moves and its
list closes, so no location can be picked. Nothing throws.

Render the dialog beside the menu, controlled, and open it from the item's
`onSelect` (Enter and Space click the item, never a button inside it):

```tsx
// ❌ Bad
<DropdownMenuItem><CheckoutDialog booking={booking} /></DropdownMenuItem>

// ✅ Good
<CheckoutDialog booking={booking} open={open} onOpenChange={setOpen}
  returnFocusTo={() => triggerRef.current} />
<DropdownMenuItem onSelect={(e) => { e.preventDefault(); setOpen(true); closeMenu(); }}>
```

The same holds for any dialog with a popover, select or date picker. See
`checkout-dropdown.tsx`; pinned by `checkout-dropdown.test.tsx`.
