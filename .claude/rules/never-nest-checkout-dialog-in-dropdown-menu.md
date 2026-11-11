---
description: Never render CheckoutDialog (or any dialog with selects or pickers) inside a DropdownMenu; open it from the menu row and render it beside the menu.
paths:
  - "apps/webapp/app/components/**/*.tsx"
  - "apps/webapp/app/routes/**/*.tsx"
---

# Never Put `CheckoutDialog` Inside A `DropdownMenu`

A dialog portals out of the menu in the DOM, but React still bubbles its events
through its component parents. A Radix `DropdownMenuItem` focuses itself on
every mouse `pointermove` it sees, so moving the mouse over the dialog's "From
location" `<select>` blurs it, and a native select shuts its option list on
blur. The operator cannot pick a location. Nothing throws, and the dialog looks
fine until someone tries it with a mouse.

The menu row only opens the dialog. Render the dialog outside `<DropdownMenu>`,
controlled through its `open` / `onOpenChange` props:

```tsx
// ❌ Bad: the dialog's select dies on mouse move
<DropdownMenuItem onSelect={(e) => e.preventDefault()}>
  <CheckoutDialog booking={booking} variant="dropdown" />
</DropdownMenuItem>

// ✅ Good: the row opens it, the dialog lives beside the menu
<CheckoutDialog booking={booking} open={open} onOpenChange={setOpen} />
<DropdownMenu modal={false}>
  …
  <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
    <Button type="button" variant="link" onClick={() => { setOpen(true); closeMenu(); }}>
      Check out
    </Button>
  </DropdownMenuItem>
</DropdownMenu>
```

The same holds for any dialog with a `<select>`, date picker or combobox.
References: `checkout-dropdown.tsx`, `list-bulk-actions-dropdown.tsx`. Pinned by
the "From location select" case in `checkout-dropdown.test.tsx`.
