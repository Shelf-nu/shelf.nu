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

## Development

To add new rules:

1. Create a new `.cjs` file in `eslint-local-rules/`
2. Export the rule using standard ESLint rule format
3. Add the rule to `eslint-local-rules/index.cjs`
4. Add the rule to `.eslintrc` rules section
5. Document the rule in this README

## Why `.cjs` files?

This project uses ES modules (`"type": "module"` in `package.json`), but ESLint requires CommonJS modules. Files must use `.cjs` extension to be treated as CommonJS.
