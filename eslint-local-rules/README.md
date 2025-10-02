# Custom ESLint Rules

This directory contains custom ESLint rules for the Shelf project.

## Rules

### `require-satisfies-on-nested-prisma-selects`

**Purpose**: Enforce type safety for nested Prisma selects in `getUserByID` calls.

**Problem**: TypeScript's generic constraints (`T extends Prisma.UserSelect`) don't validate nested object fields deeply. This means invalid field names in nested relation selects (like accessing non-existent fields on related models) won't be caught at compile time.

**Solution**: This rule requires developers to use the `satisfies` operator when calling `getUserByID` with nested selects. This enables TypeScript's deep type validation.

#### Examples

❌ **Bad** (will cause ESLint error):

```typescript
const user = await getUserByID(id, {
  select: {
    id: true,
    qrCodes: {
      select: {
        id: true,
        invalidField: true, // TypeScript won't catch this!
      },
    },
  },
});
```

✅ **Good** (passes ESLint and TypeScript validates deeply):

```typescript
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

The rule only triggers when:

1. The function called is `getUserByID`
2. It has a second argument with `select` or `include` property
3. The select/include has **nested** relation selects (not just flat field selects)

Simple selects without nesting don't require `satisfies`:

```typescript
// This is fine without satisfies (no nested selects)
const user = await getUserByID(id, {
  select: { id: true, email: true },
});
```

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
