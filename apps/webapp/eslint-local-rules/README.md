# Custom ESLint Rules

This directory contains custom ESLint rules for the Shelf project.

## Rules

### `require-satisfies-on-nested-prisma-selects`

**Purpose**: Enforce type safety for all Prisma selects/includes in `getUserByID` calls.

**Problem**: TypeScript's generic constraints (`T extends Prisma.UserSelect`) don't perform strict property checking on wrapper functions. This means invalid field names in selects won't be caught at compile time, even for flat (non-nested) fields.

**Solution**: This rule requires developers to use the `satisfies` operator when calling `getUserByID` with any select or include. This forces TypeScript to validate all field names before type inference.

#### Examples

❌ **Bad** (will cause ESLint error):

```typescript
// Flat fields - TypeScript won't catch invalid fields without satisfies
const user = await getUserByID(id, {
  select: {
    id: true,
    invalidField: true, // TypeScript won't catch this!
  },
});

// Nested fields - also not validated
const user = await getUserByID(id, {
  select: {
    id: true,
    qrCodes: {
      select: {
        id: true,
        invalidField: true, // TypeScript won't catch this either!
      },
    },
  },
});
```

✅ **Good** (passes ESLint and TypeScript validates all fields):

```typescript
// Flat fields with satisfies
const user = await getUserByID(id, {
  select: {
    id: true,
    invalidField: true, // TypeScript ERROR! Field doesn't exist ✓
  },
} satisfies Prisma.UserSelect);

// Nested fields with satisfies
const user = await getUserByID(id, {
  select: {
    id: true,
    qrCodes: {
      select: {
        id: true,
        invalidField: true, // TypeScript ERROR! Field doesn't exist ✓
      },
    },
  },
} satisfies Prisma.UserSelect);
```

#### When does the rule trigger?

The rule triggers when:

1. The function called is `getUserByID`
2. It has a second argument with `select` or `include` property

**All** selects and includes must use `satisfies`, whether flat or nested.

#### Accepted patterns

The rule accepts:

- `satisfies Prisma.UserSelect`
- `satisfies Prisma.UserInclude`
- `satisfies Prisma.UserFindUniqueArgs`
- `as const satisfies Prisma.UserSelect`

### `require-deleted-at-check-on-custom-field-queries`

**Purpose**: Ensure all CustomField queries filter out soft-deleted fields.

**Problem**: CustomField uses soft delete (deletedAt field). Developers might forget to filter out soft-deleted fields, causing deleted fields to appear in queries.

**Solution**: This rule requires all `db.customField` or `tx.customField` queries to include `deletedAt` in the where clause.

#### Examples

❌ **Bad** (will cause ESLint error):

```typescript
// Missing deletedAt filter
const fields = await db.customField.findMany({
  where: { organizationId },
});

// No where clause at all
const count = await db.customField.count();

// Ternary with missing deletedAt in one branch
const fields = await db.customField.findMany({
  where: selectAll ? { organizationId, deletedAt: null } : { id: { in: ids } }, // ❌ Missing deletedAt!
});
```

✅ **Good** (passes ESLint):

```typescript
// Filtering for active (non-deleted) fields
const fields = await db.customField.findMany({
  where: { organizationId, deletedAt: null },
});

// Querying for deleted fields
const deleted = await db.customField.findMany({
  where: { organizationId, deletedAt: { not: null } },
});

// In transactions
const field = await tx.customField.findFirst({
  where: { id, organizationId, deletedAt: null },
});

// Ternary with deletedAt in both branches
const fields = await db.customField.findMany({
  where: selectAll
    ? { organizationId, deletedAt: null }
    : { id: { in: ids }, deletedAt: null }, // ✅ Both branches have deletedAt
});
```

#### When does the rule trigger?

The rule triggers when:

1. Calling query methods on `db.customField` or `tx.customField`
2. Query methods: `findMany`, `findFirst`, `findUnique`, `findUniqueOrThrow`, `findFirstOrThrow`, `count`, `aggregate`
3. The `where` clause doesn't include a `deletedAt` filter
4. **Ternary operators**: Both branches of a ternary expression are checked independently

## Development

To add new rules:

1. Create a new `.cjs` file in `eslint-local-rules/`
2. Export the rule using standard ESLint rule format
3. Add the rule to `eslint-local-rules/index.cjs`
4. Add the rule to `.eslintrc` rules section
5. Document the rule in this README
6. Restart your IDE or ESLint server for changes to take effect

## Why `.cjs` files?

This project uses ES modules (`"type": "module"` in `package.json`), but ESLint requires CommonJS modules. Files must use `.cjs` extension to be treated as CommonJS.
