# Scanner Drawer Development Guide

This guide explains how to create and maintain scanner drawers in Shelf.nu, ensuring consistency and proper use of existing patterns and atoms.

## Overview

Scanner drawers are specialized UI components that manage scanned QR code items (assets and kits) for various operations like:

- Adding assets to bookings
- Adding assets to kits
- Adding assets to locations
- Assigning/releasing custody
- Checking in/out assets

## Key Components & Patterns

### QR Scanner Atoms

All scanner drawers should use the centralized atoms in `app/atoms/qr-scanner.ts`:

#### Core Atoms

- **`scannedItemsAtom`**: Main state containing all scanned items keyed by QR ID
- **`scannedItemIdsAtom`**: ⭐ **Derived atom** that efficiently extracts asset and kit IDs from scanned items
- **`addScannedItemAtom`**: Adds a new scanned item to the state
- **`updateScannedItemAtom`**: Updates an existing scanned item with data
- **`clearScannedItemsAtom`**: Clears all scanned items
- **`removeScannedItemAtom`**: Removes a single item by QR ID
- **`removeMultipleScannedItemsAtom`**: Removes multiple items by QR IDs
- **`removeScannedItemsByAssetIdAtom`**: Removes items by asset/kit IDs

#### Data Structure

```typescript
type ScanListItems = {
  [qrId: string]: ScanListItem;
};

type ScanListItem =
  | {
      data?: KitFromQr | AssetFromQr;
      error?: string;
      type?: "asset" | "kit";
      codeType?: "qr" | "barcode";
    }
  | undefined;
```

The `scannedItemIdsAtom` returns:

```typescript
{
  assetIds: string[];    // Array of asset IDs
  kitIds: string[];      // Array of kit IDs
  idsTotalCount: number; // Total count of both assets and kits
}
```

#### When to Use Each Atom

- **`scannedItemIdsAtom`**: For form submissions, counts, and any logic needing just the IDs
- **`scannedItemsAtom`**: When you need full objects for complex business logic or rendering
- **Remove atoms**: For handling blockers and invalid items in scanner drawers

#### ⚠️ **Always Use scannedItemIdsAtom for ID Extraction**

**❌ DON'T** manually filter items to extract IDs:

```typescript
// BAD - Manual filtering (inefficient and inconsistent)
const assetIds = Object.values(items)
  .filter((item) => !!item && item.data && item.type === "asset")
  .map((item) => item?.data?.id);

const kitIds = Object.values(items)
  .filter((item) => !!item && item.data && item.type === "kit")
  .map((item) => item?.data?.id);
```

**✅ DO** use the purpose-built atom:

```typescript
// GOOD - Use the efficient derived atom
const { assetIds, kitIds, idsTotalCount } = useAtomValue(scannedItemIdsAtom);
```

### Required Imports

```typescript
import { useAtomValue, useSetAtom } from "jotai";
import {
  clearScannedItemsAtom,
  removeScannedItemAtom,
  scannedItemsAtom,
  scannedItemIdsAtom, // Always import this for ID extraction
  removeScannedItemsByAssetIdAtom,
  removeMultipleScannedItemsAtom,
} from "~/atoms/qr-scanner";
```

## Drawer Architecture

### Base Structure

All scanner drawers follow this structure:

1. **Import required atoms and utilities**
2. **Get scanned data using atoms**
3. **Filter and prepare data for rendering**
4. **Set up blockers for invalid items**
5. **Render using ConfigurableDrawer**

### Standard Drawer Template

```typescript
import { useAtomValue, useSetAtom } from "jotai";
import { z } from "zod";
import {
  clearScannedItemsAtom,
  removeScannedItemAtom,
  scannedItemsAtom,
  scannedItemIdsAtom,
  removeScannedItemsByAssetIdAtom,
  removeMultipleScannedItemsAtom,
} from "~/atoms/qr-scanner";
import { createBlockers } from "../blockers-factory";
import ConfigurableDrawer from "../configurable-drawer";

// Define your schema
export const yourDrawerSchema = z.object({
  assetIds: z.array(z.string()).min(1),
});

export default function YourDrawer({
  className,
  style,
  isLoading,
  defaultExpanded = false,
}: {
  className?: string;
  style?: React.CSSProperties;
  isLoading?: boolean;
  defaultExpanded?: boolean;
}) {
  // 1. Get scanned data using atoms
  const items = useAtomValue(scannedItemsAtom);
  const { assetIds, kitIds, idsTotalCount } = useAtomValue(scannedItemIdsAtom);

  // 2. Get atom setters for clearing/removing items
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);
  const removeAssetsFromList = useSetAtom(removeScannedItemsByAssetIdAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);

  // 3. Filter and prepare data for rendering (when you need full objects)
  const assets = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data as AssetFromQr);

  const kits = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "kit")
    .map((item) => item?.data as KitFromQr);

  // 4. Set up error filtering
  const errors = Object.entries(items).filter(([, item]) => !!item?.error);

  // 5. Create blockers for invalid items
  const blockerConfigs = [
    {
      condition: errors.length > 0,
      count: errors.length,
      message: (count: number) => (
        <>
          <strong>{`${count} QR codes `}</strong> are invalid.
        </>
      ),
      onResolve: () => removeItemsFromList(errors.map(([qrId]) => qrId)),
    },
    // Add more blocker configurations as needed
  ];

  const [hasBlockers, Blockers] = createBlockers({
    blockerConfigs,
    onResolveAll: () => {
      // Handle resolving all blockers
    },
  });

  // 6. Render using ConfigurableDrawer
  return (
    <ConfigurableDrawer
      schema={yourDrawerSchema}
      defaultValues={{ assetIds }}
      title="Your Drawer Title"
      Blockers={Blockers}
      hasBlockers={hasBlockers}
      clearList={clearList}
      // ... other props
    />
  );
}
```

## Common Patterns

### Asset/Kit Filtering for Different Purposes

```typescript
// For form submission - use the atom
const { assetIds, kitIds } = useAtomValue(scannedItemIdsAtom);

// For complex business logic - filter full objects when needed
const availableAssets = assets.filter(
  (asset) => asset.status === AssetStatus.AVAILABLE
);

// For kit asset expansion
const allAssetIds = Array.from(
  new Set([...assetIds, ...kits.flatMap((k) => k.assets.map((a) => a.id))])
);
```

### Blocker Patterns

```typescript
// Standard error blocker
{
  condition: errors.length > 0,
  count: errors.length,
  message: (count: number) => (
    <>
      <strong>{`${count} QR codes `}</strong> are invalid.
    </>
  ),
  onResolve: () => removeItemsFromList(errors.map(([qrId]) => qrId)),
}

// Kit blocker (when kits not allowed)
{
  condition: kitQrIds.length > 0,
  count: kitQrIds.length,
  message: (count: number) => (
    <>
      <strong>{`${count} kit${count > 1 ? "s" : ""}`}</strong> detected.
      Kits cannot be added to this context.
    </>
  ),
  onResolve: () => removeItemsFromList(kitQrIds),
}

// Status-based blockers
{
  condition: assetsInWrongStatus.length > 0,
  count: assetsInWrongStatus.length,
  message: (count: number) => (
    <>
      <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong> in the wrong status.
    </>
  ),
  onResolve: () => removeAssetsFromList(assetsInWrongStatusIds),
}
```

## Factory Components

### ConfigurableDrawer

The main drawer component that handles:

- Form submission with Zod validation
- Standard drawer UI and interactions
- Integration with blockers
- Error handling

### createBlockers

Factory function for creating consistent blocker UI:

```typescript
const [hasBlockers, Blockers] = createBlockers({
  blockerConfigs: [...],
  onResolveAll: () => { /* cleanup logic */ },
});
```

### createAvailabilityLabels

Factory for creating status labels:

```typescript
const labels = createAvailabilityLabels(assetLabelPresets.booking);
```

## Testing Your Drawer

### Manual Testing Checklist

1. **Basic Functionality**:

   - [ ] Drawer opens and closes correctly
   - [ ] Items appear when scanned
   - [ ] Form submission works with valid items

2. **Blocker Testing**:

   - [ ] Invalid QR codes show error blockers
   - [ ] Wrong item types (kits when not allowed) show blockers
   - [ ] Wrong status items show appropriate blockers
   - [ ] "Resolve All" button works correctly

3. **Edge Cases**:

   - [ ] Empty state displays correctly
   - [ ] Duplicate items are handled properly
   - [ ] Form validation works with no items
   - [ ] Large numbers of items perform well

4. **Atom Consistency**:
   - [ ] Uses `scannedItemIdsAtom` for ID extraction
   - [ ] Properly imports all required atoms
   - [ ] Consistent with other drawers

## Performance Considerations

### ✅ Efficient Patterns

- Use `scannedItemIdsAtom` for ID extraction (computed once, used everywhere)
- Only filter full objects when you need the complete data
- Use blockers to prevent unnecessary form submissions

### ❌ Performance Anti-patterns

- Manual filtering of `Object.values(items)` for IDs
- Re-computing the same filtered arrays multiple times
- Not using the derived atoms

## Common Pitfalls

1. **Not using scannedItemIdsAtom**: Always use the atom for ID extraction
2. **Inconsistent imports**: Follow the standard import pattern
3. **Missing blockers**: Always handle invalid items with appropriate blockers
4. **Complex filtering in render**: Move complex logic outside render where possible
5. **Not handling kits properly**: Remember kits contain assets that may need expansion

## Examples

See these existing drawers for reference:

- `assign-custody-drawer.tsx` - Full featured with asset and kit handling
- `update-location-drawer.tsx` - Simple asset-only drawer
- `add-assets-to-booking-drawer.tsx` - Complex business logic with kit expansion
- `partial-checkin-drawer.tsx` - Advanced filtering and status management

## Migration Guide

If you have an existing drawer that doesn't use `scannedItemIdsAtom`:

1. Add `scannedItemIdsAtom` to imports
2. Replace manual ID filtering with atom usage:

   ```typescript
   // Replace this:
   const assetIds = Object.values(items)
     .filter((item) => !!item && item.data && item.type === "asset")
     .map((item) => item?.data?.id);

   // With this:
   const { assetIds } = useAtomValue(scannedItemIdsAtom);
   ```

3. Keep full object filtering only where you need the complete data
4. Test thoroughly to ensure behavior is unchanged
