# Atoms Directory

Here we can place atoms that are related to routes so we don't make the route files too much to handle.

The atom file name should be corresponding to the route name.

## QR Scanner Atoms (`qr-scanner.ts`)

The QR scanner atoms manage the state of scanned items across all scanner drawers in the application.

### Core Atoms

- **`scannedItemsAtom`**: The main state containing all scanned items, keyed by QR ID
- **`scannedItemIdsAtom`**: ⭐ **Derived atom** that efficiently extracts asset and kit IDs from scanned items
- **`addScannedItemAtom`**: Adds a new scanned item to the state
- **`updateScannedItemAtom`**: Updates an existing scanned item with data
- **`removeScannedItemAtom`**: Removes a single item by QR ID
- **`removeMultipleScannedItemsAtom`**: Removes multiple items by QR IDs
- **`removeScannedItemsByAssetIdAtom`**: Removes items by their asset/kit IDs
- **`clearScannedItemsAtom`**: Clears all scanned items

### Usage Guidelines

#### ✅ Always Use `scannedItemIdsAtom` for ID Extraction

```typescript
// GOOD - Use the efficient derived atom
const { assetIds, kitIds, idsTotalCount } = useAtomValue(scannedItemIdsAtom);
```

#### ❌ Don't Manually Filter for IDs

```typescript
// BAD - Manual filtering (inefficient and inconsistent)
const assetIds = Object.values(items)
  .filter((item) => !!item && item.data && item.type === "asset")
  .map((item) => item?.data?.id);
```

#### When to Use Each Atom

- **`scannedItemIdsAtom`**: For form submissions, counts, and any logic needing just the IDs
- **`scannedItemsAtom`**: When you need full objects for complex business logic or rendering
- **Remove atoms**: For handling blockers and invalid items in scanner drawers

### Scanner Drawer Development

For detailed information on creating scanner drawers, see [Scanner Drawer Development Guide](../../docs/scanner-drawer-development.md).

### Data Structure

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
