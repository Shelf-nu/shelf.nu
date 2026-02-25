# Barcode Types Development Guide

This guide provides comprehensive instructions for developers on how to add new barcode types to the Shelf.nu application. Due to the distributed nature of barcode handling across multiple layers of the application, this guide ensures all necessary changes are made systematically.

## Overview

The barcode system in Shelf.nu is implemented across multiple layers:

- **Database Schema** - Type definitions and storage
- **Validation Layer** - Type-specific validation rules
- **API Layer** - Database queries and filtering
- **UI Layer** - Form components and column rendering
- **Import/Export** - CSV handling and templates
- **Scanner Integration** - Detection and processing

## ⚠️ Important: Complete Checklist Required

Adding a new barcode type requires changes in **15+ files** across the codebase. Missing any of these changes will result in broken functionality. Use this guide as a complete checklist.

## Step-by-Step Implementation Guide

### 1. Database Schema Updates

#### 1.1 Update Prisma Schema

**File:** `packages/database/prisma/schema.prisma`

```prisma
enum BarcodeType {
  Code128
  Code39
  DataMatrix
  // Add your new type here
  YourNewType
}
```

#### 1.2 Create Database Migration

```bash
pnpm --filter @shelf/webapp exec prisma migrate dev --name add-new-barcode-type
```

### 2. Validation Layer Updates

#### 2.1 Add Length Constants

**File:** `app/modules/barcode/validation.ts`

```typescript
export const BARCODE_LENGTHS = {
  CODE128_MIN: 4,
  CODE128_MAX: 40,
  CODE128_WARN_THRESHOLD: 30,
  CODE39_MIN: 4,
  CODE39_MAX: 43,
  DATAMATRIX_MIN: 4,
  DATAMATRIX_MAX: 100,
  // Add your new type constants
  YOURNEWTYPE_MIN: 4,
  YOURNEWTYPE_MAX: 20,
} as const;
```

#### 2.2 Create Validation Function

**File:** `app/modules/barcode/validation.ts`

```typescript
/**
 * Validation rules for YourNewType barcodes
 * Description of your barcode type constraints
 */
const validateYourNewType = (value: string) => {
  if (!value || value.length === 0) {
    return "Barcode value is required";
  }

  if (value.length < BARCODE_LENGTHS.YOURNEWTYPE_MIN) {
    return `YourNewType barcode must be at least ${BARCODE_LENGTHS.YOURNEWTYPE_MIN} characters`;
  }

  if (value.length > BARCODE_LENGTHS.YOURNEWTYPE_MAX) {
    return `YourNewType barcode too long (max ${BARCODE_LENGTHS.YOURNEWTYPE_MAX} characters)`;
  }

  // Add your specific character validation here
  const validationRegex = /^[YOUR_REGEX_PATTERN]*$/;
  if (!validationRegex.test(value)) {
    return "YourNewType barcode contains invalid characters";
  }

  return null;
};
```

#### 2.3 Update Validation Switch Statement

**File:** `app/modules/barcode/validation.ts`

```typescript
export function validateBarcodeValue(
  type: BarcodeType,
  value: string
): string | null {
  switch (type) {
    case BarcodeType.Code128:
      return validateCode128(value);
    case BarcodeType.Code39:
      return validateCode39(value);
    case BarcodeType.DataMatrix:
      return validateDataMatrix(value);
    case BarcodeType.YourNewType:
      return validateYourNewType(value);
    default:
      return "Unknown barcode type";
  }
}
```

#### 2.4 Update Normalization Function

**File:** `app/modules/barcode/validation.ts`

⚠️ **CRITICAL**: The `normalizeBarcodeValue` function handles case conversion for different barcode types. This is essential for consistent database storage and validation.

```typescript
/**
 * Normalizes a barcode value based on its type
 * Most barcode types are converted to uppercase, but some (like ExternalQR) preserve original case
 */
export function normalizeBarcodeValue(
  type: BarcodeType,
  value: string
): string {
  switch (type) {
    case BarcodeType.ExternalQR:
      return value; // Preserve original case for URLs and flexible content
    case BarcodeType.Code128:
    case BarcodeType.Code39:
    case BarcodeType.DataMatrix:
    case BarcodeType.YourNewType: // Add your new type here
      return value.toUpperCase(); // Convert to uppercase for consistency
    default:
      return value.toUpperCase(); // Default to uppercase
  }
}
```

**Usage Examples:**

```typescript
// Before storing in database
const normalizedValue = normalizeBarcodeValue(
  BarcodeType.YourNewType,
  userInput
);

// Before validation
const normalizedValue = normalizeBarcodeValue(type, value);
const validationError = validateBarcodeValue(type, normalizedValue);
```

### 3. Constants and Configuration

#### 3.1 Add Type Option Configuration

**File:** `app/modules/barcode/constants.ts`

```typescript
export const BARCODE_TYPE_OPTIONS = [
  {
    value: BarcodeType.Code128,
    label: "Code 128",
    description:
      "4-40 characters, supports letters, numbers, and symbols (e.g., ABC-123)",
  },
  {
    value: BarcodeType.Code39,
    label: "Code 39",
    description: "4-43 characters, letters and numbers only (e.g., ABC123)",
  },
  {
    value: BarcodeType.DataMatrix,
    label: "DataMatrix",
    description:
      "4-100 characters, supports letters, numbers, and symbols (e.g., ABC-123)",
  },
  // Add your new type configuration
  {
    value: BarcodeType.YourNewType,
    label: "Your New Type",
    description: "Your description of character limits and allowed characters",
  },
];
```

### 4. Asset Index and Column Management

#### 4.1 Add Field Definition

**File:** `app/modules/asset-index-settings/helpers.ts`

```typescript
export const barcodeFields = [
  "barcode_Code128",
  "barcode_Code39",
  "barcode_DataMatrix",
  "barcode_YourNewType", // Add your new field
] as const;
```

#### 4.2 Add Column Label Mapping

**File:** `app/modules/asset-index-settings/helpers.ts`

```typescript
export const columnsLabelsMap: Record<string, string> = {
  // ... existing mappings
  barcode_Code128: "Code128",
  barcode_Code39: "Code39",
  barcode_DataMatrix: "DataMatrix",
  barcode_YourNewType: "Your New Type", // Add your new label
};
```

### 5. Database Query Layer

#### 5.1 Add SQL Subquery for Sorting

**File:** `app/modules/asset/query.server.ts`

```typescript
// Add your new barcode type subquery
barcode_YourNewType: `(
  SELECT b.value
  FROM public."Barcode" b
  WHERE b."assetId" = a.id
  AND b.type = 'YourNewType'
  LIMIT 1
)`,
```

#### 5.2 Add Filter Recognition

**File:** `app/modules/asset/query.server.ts`

Ensure your new barcode type is handled in the filter processing logic by following the existing pattern for barcode field recognition (`filter.name.startsWith("barcode_")`).

### 6. Import/Export System

#### 6.1 Add CSV Header

**File:** `app/modules/asset/utils.server.ts`

```typescript
export const ASSET_CSV_HEADERS = [
  // ... existing headers
  "barcode_Code128",
  "barcode_Code39",
  "barcode_DataMatrix",
  "barcode_YourNewType", // Add your new header
];
```

#### 6.2 Add Import Service Mapping

**File:** `app/modules/barcode/service.server.ts`

```typescript
const columnToTypeMap: Record<string, BarcodeType> = {
  barcode_Code128: BarcodeType.Code128,
  barcode_Code39: BarcodeType.Code39,
  barcode_DataMatrix: BarcodeType.DataMatrix,
  barcode_YourNewType: BarcodeType.YourNewType, // Add your new mapping
};
```

#### 6.3 Update CSV Template

**File:** `public/static/shelf.nu-example-asset-import-from-content-with-barcodes.csv`

```csv
title,description,barcode_Code128,barcode_Code39,barcode_DataMatrix,barcode_YourNewType
"Example Asset","Example description","","","",""
```

### 7. UI Components

#### 7.1 Add Column Rendering

**File:** `app/components/assets/assets-index/advanced-asset-columns.tsx`

```typescript
// Add to switch statement
case "barcode_YourNewType":
  return <BarcodeColumn key={field} asset={asset} type="YourNewType" />;

// Add to type mapping
const typeMap: Record<string, BarcodeType> = {
  Code128: BarcodeType.Code128,
  Code39: BarcodeType.Code39,
  DataMatrix: BarcodeType.DataMatrix,
  YourNewType: BarcodeType.YourNewType, // Add your new type
};
```

#### 7.2 Add Barcode Display Support

**File:** `app/components/barcode/barcode-display.tsx`

⚠️ **CRITICAL**: The BarcodeDisplay component handles visual rendering of barcodes using bwip-js. Missing this update will prevent barcode visualization.

```typescript
// Map barcode types to bwip-js format strings
const formatMap: Record<BarcodeType, string> = {
  Code128: "code128",
  Code39: "code39",
  DataMatrix: "datamatrix",
  ExternalQR: "qrcode",
  YourNewType: "yournewtype", // Add your bwip-js format name
};
```

**Important:** Ensure the bwip-js format name matches the exact format supported by the bwip-js library.

### 8. Scanner Integration

#### 8.1 Check zxing Format Name

**⚠️ IMPORTANT**: Before adding your new barcode type, check what format name zxing-wasm uses for your barcode type. This can be found in the zxing-wasm documentation or by testing the scanner.

**Enum Naming Rule**: PostgreSQL enum values cannot contain dashes. If zxing uses a format name with dashes (e.g., "EAN-13"), you must use an alternative in your enum (e.g., "EAN13") and add format mapping.

#### 8.2 Add Scanner Detection

**File:** `app/components/scanner/utils.tsx`

```typescript
// Add to detection order (place appropriately based on detection priority)
const orderedTypes = [
  BarcodeType.Code128,
  BarcodeType.Code39,
  BarcodeType.DataMatrix,
  BarcodeType.YourNewType, // Add your new type
];
```

#### 8.3 Add Format Mapping (if needed)

**File:** `app/components/scanner/utils.tsx`

If zxing format name doesn't match your enum value (e.g., "EAN-13" vs "EAN13"), add mapping:

```typescript
} else if (
  SUPPORTED_BARCODE_FORMATS.includes(detectedFormat) ||
  detectedFormat === 'Your-Zxing-Format' // Add your zxing format name if different
) {
  // Note: zxing returns "Your-Zxing-Format" but PostgreSQL enums can't contain dashes,
  // so our enum uses "YourZxingFormat". Map the scanner format to our enum value.

  // Map zxing format names to our BarcodeType enum values
  const barcodeType = detectedFormat === 'Your-Zxing-Format'
    ? 'YourZxingFormat'
    : detectedFormat as BarcodeType;
```

### 9. Search and Filter Logic

#### 9.1 Add Search Integration

**File:** `app/modules/asset/service.server.ts`

```typescript
// Add to search logic
const searchableFields = [
  "asset.barcode_Code128",
  "asset.barcode_Code39",
  "asset.barcode_DataMatrix",
  "asset.barcode_YourNewType", // Add your new field
];
```

### 10. Documentation Updates

#### 10.1 Update Import Documentation

**File:** `app/components/assets/import-content.tsx`

```typescript
// Add documentation for your new barcode type
<li>
  <b>barcode_YourNewType</b> - For YourNewType barcodes (4-20 characters,
  your specific character requirements)
</li>
```

### 11. Form Components

#### 11.1 Update Default Types (if needed)

**File:** `app/components/forms/barcodes-input.tsx`

```typescript
// Update default type if your new type should be the default
const defaultBarcode = { type: BarcodeType.YourNewType, value: "" };
```

### 12. Testing

#### 12.1 Add Test Cases

**File:** `app/modules/barcode/service.server.test.ts`

```typescript
describe("YourNewType barcode validation", () => {
  it("should validate correct YourNewType barcode", () => {
    const result = validateBarcodeValue(BarcodeType.YourNewType, "VALID123");
    expect(result).toBeNull();
  });

  it("should reject invalid YourNewType barcode", () => {
    const result = validateBarcodeValue(BarcodeType.YourNewType, "invalid!");
    expect(result).toContain("invalid characters");
  });
});
```

#### 12.2 Update Test Data

Add your new barcode type to existing test data structures throughout the test files.

## Barcode Type Implementation Checklist

Use this checklist to ensure all necessary changes are made:

- [ ] **Database Schema** - Added to BarcodeType enum
- [ ] **Database Migration** - Created and applied
- [ ] **Validation Constants** - Added length constants
- [ ] **Validation Function** - Created type-specific validation
- [ ] **Validation Switch** - Updated switch statement
- [ ] **Normalization Function** - Updated normalizeBarcodeValue function ⚠️ **CRITICAL**
- [ ] **Type Options** - Added to BARCODE_TYPE_OPTIONS
- [ ] **Field Definition** - Added to barcodeFields array
- [ ] **Column Label** - Added to columnsLabelsMap
- [ ] **SQL Subquery** - Added for sorting/filtering
- [ ] **CSV Header** - Added to ASSET_CSV_HEADERS
- [ ] **Import Mapping** - Added to columnToTypeMap
- [ ] **CSV Template** - Updated example file
- [ ] **Column Rendering** - Added to switch statement
- [ ] **Barcode Display** - Added to formatMap in BarcodeDisplay component ⚠️ **CRITICAL**
- [ ] **Scanner Format Check** - Verified zxing format name matches enum or added mapping ⚠️ **CRITICAL**
- [ ] **Scanner Detection** - Added to orderedTypes
- [ ] **Search Logic** - Added to searchable fields
- [ ] **Documentation** - Updated import documentation
- [ ] **Form Defaults** - Updated if needed
- [ ] **Tests** - Added comprehensive test cases
- [ ] **TypeScript** - No type errors
- [ ] **Manual Testing** - Tested all functionality

## Best Practices

### 1. Validation Design

- Keep validation rules strict but practical
- Consider real-world usage patterns
- Provide clear error messages
- Document character limitations clearly

### 2. Performance Considerations

- Barcode queries are indexed by type and value
- Consider detection order in scanner (most common first)
- Validate early to prevent unnecessary processing

### 3. User Experience

- Provide clear descriptions in form dropdowns
- Show validation feedback immediately
- Consider default type selection based on usage patterns

### 4. Testing Strategy

- Test validation edge cases
- Test import/export with new type
- Test scanner detection accuracy
- Test database performance with large datasets

### 5. Documentation

- Update user-facing documentation
- Add developer comments for complex validation
- Document any special handling requirements

## Common Pitfalls

1. **Missing Normalization Function Update** - Values won't be processed correctly, causing validation and database issues ⚠️ **CRITICAL**
2. **Missing BarcodeDisplay formatMap Update** - Barcodes won't render visually, showing error messages instead ⚠️ **CRITICAL**
3. **Scanner Format Mismatch** - Scanner shows "unsupported barcode" error when zxing format name doesn't match enum ⚠️ **CRITICAL**
4. **Missing CSV Template Update** - Users won't be able to import the new type
5. **Incorrect SQL Subquery** - Sorting/filtering won't work
6. **Missing Scanner Detection** - Camera scanning won't recognize the type
7. **Incomplete Test Coverage** - Edge cases may break production
8. **Missing Column Rendering** - UI will show empty cells
9. **Incorrect Validation Regex** - Users can't enter valid barcodes

## Troubleshooting

### TypeScript Errors

- Ensure all enum references are updated
- Check type imports in all modified files
- Verify proper type assertions in components

### Database Errors

- Ensure migration is applied correctly
- Check that enum values match exactly
- Verify foreign key constraints

### UI Issues

- Check column rendering switch statement
- Verify label mappings are correct
- Test form validation feedback

### Import/Export Issues

- Check CSV header matching
- Verify import service mapping
- Test with actual CSV data

## Future Improvements

Consider implementing these improvements for better maintainability:

1. **Centralized Configuration** - Move all barcode type definitions to a single configuration file
2. **Automated Testing** - Add integration tests for full barcode workflow
3. **Dynamic Type Loading** - Allow runtime configuration of barcode types
4. **Validation Plugin System** - Modular validation rules
5. **Better Error Handling** - More specific error messages and recovery

## Support

For questions or issues with adding new barcode types:

1. Check this documentation first
2. Review existing barcode type implementations
3. Run the complete test suite
4. Verify all checklist items are completed

Remember: Adding a new barcode type is a significant change that affects multiple layers of the application. Take time to test thoroughly and follow this guide completely.
