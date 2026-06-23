---
description: Bulk actions on index/list pages must clear the multi-select on success via the shared chokepoint, not bespoke per-dialog logic.
globs: apps/webapp/app/components/**/bulk-*.tsx, apps/webapp/app/components/bulk-update-dialog/*.tsx
---

# Clear Bulk Selection On Success

After a bulk action succeeds, the multi-select (`selectedBulkItemsAtom`) must be
**cleared** so users don't have to "unselect all" before the next batch. This is
centralized in `BulkUpdateDialogContent` (`~/components/bulk-update-dialog/bulk-update-dialog.tsx`):
its `handleBulkActionSuccess` clears the selection on success for **all** dialog
types. The ~37 bulk dialogs that route through it get this for free — do **not**
re-implement clearing in a feature dialog.

Opt out only when a dialog stays open showing an **in-dialog success panel** that
re-uses the selection (e.g. add-to-existing-booking "Add more"): pass
`keepSelectionOnSuccess`. Pair it with `skipCloseOnSuccess` (the two are
independent: one keeps the selection, the other keeps the dialog open).

**Deliberately excluded:** read-only exports / QR downloads keep the selection
(no mutation). The booking-detail check-in/out dialogs clear via their own
`clearSelectedBulkItemsAtom` effect (they bypass the chokepoint). The `manage-*`
routes own their selection lifecycle (cleared via redirect + `AtomsResetHandler`).

```tsx
// ❌ Bad — bespoke clearing in a feature dialog that already routes through the chokepoint
useEffect(() => { if (fetcher.data?.success) setSelectedItems([]); }, [fetcher.data]);

// ✅ Good — let the shared dialog clear it; opt out only for success-panel reuse
<BulkUpdateDialogContent type="location" arrayFieldId="assetIds" />
<BulkUpdateDialogContent type="booking-exist" skipCloseOnSuccess keepSelectionOnSuccess />
```
