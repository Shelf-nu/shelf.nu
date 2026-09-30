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

### `require-button-type`

**Purpose**: Enforce explicit `type` prop on all `<Button>` components rendering as native buttons.

**Problem**: The HTML spec defaults `<button>` to `type="submit"`, which can cause accidental form submissions when a button is inside a `<form>` without an explicit type.

**Solution**: This rule requires every `<Button>` to have an explicit `type` prop (`"button"`, `"submit"`, or `"reset"`) unless it renders as a non-button element.

#### Examples

❌ **Bad** (will cause ESLint error):

```tsx
<Button onClick={handler}>Cancel</Button>
<Button variant="secondary">Close</Button>
```

✅ **Good** (passes ESLint):

```tsx
<Button type="button" onClick={handler}>Cancel</Button>
<Button type="submit" disabled={disabled}>Save</Button>
<Button to="/home">Home</Button>           // Link button, no type needed
<Button as="a" href="mailto:...">Email</Button>  // Anchor element, no type needed
```

#### When does the rule skip checking?

The rule does NOT flag:

1. **Link buttons**: `<Button to="...">` (renders as `<Link>`, not `<button>`)
2. **Custom elements**: `<Button as="a">`, `<Button as="span">` (not a native button)
3. **Custom components**: `<Button as={SomeComponent}>` (not a native button)
4. **Spread props**: `<Button {...props}>` (can't statically verify)
5. **React Email buttons**: `Button` imported from `@react-email/components` (different component)

### `no-test-files-in-routes`

**Purpose**: Keep test files out of `app/routes/`.

**Problem**: Vite's dev-server warmup (`server.warmup.clientFiles` in `vite.config.ts`) pulls **every** file under `app/routes/` into the **client** module graph. A co-located test is not a route — `ignoredRouteFiles` in `app/routes.ts` excludes it from the route tree — but warmup does not care, so as soon as it imports a `*.server` module React Router fails the transform:

```
Pre-transform error: Server-only module referenced by client
  '~/modules/api/mobile-auth.server' imported by
  'app/routes/api+/mobile+/qr.claim.test.ts'
```

Route tests exist to test loaders/actions, so they essentially always import a `*.server` module — every co-located route test breaks `pnpm webapp:dev`. Typecheck, lint and the unit suite all pass, so `validate` and CI never catch it. This has regressed more than once.

**Solution**: Route tests live in `apps/webapp/test/routes-tests/`, mirroring the route path, and import the route via the `~/routes/...` alias.

#### Examples

❌ **Bad**:

```ts
// app/routes/api+/mobile+/qr.claim.test.ts
import { action } from "./qr.claim";
```

✅ **Good**:

```ts
// test/routes-tests/api+/mobile+/qr.claim.test.ts
import { action } from "~/routes/api+/mobile+/qr.claim";
```

The `*.test.server.ts` spelling is banned too — that infix only ever existed to dodge the warmup glob. The error message names the exact destination path to move the file to.

### `no-hand-coerced-numeric-transform`

**Purpose**: Keep hand-rolled numeric coercion out of zod `.transform()` callbacks.

**Problem**: `Number("")`, `Number("   ")` and `Number("0")` all return `0`, and `+""` is `0` too, so a bare coercion inside `.transform()` cannot tell an untouched form field from a deliberate zero. The truthiness guard usually wrapped around it only half helps: in `val ? +val : null` the string `"0"` is truthy so a real zero survives, and `""` is falsy so a missing value becomes null, but `"   "` is truthy as well and coerces to `0`. A field the operator only put spaces in is therefore stored as a deliberate zero, which is how a whitespace submission becomes a valuation of nothing.

**Solution**: `optionalNumberFromString()` and `requiredNumberFromString()` in `app/utils/zod-numeric.ts` decide blank vs zero on the **string**, before any coercion, and handle trimming and `NaN` along the way. Use them instead of coercing by hand.

#### Examples

❌ **Bad** (will cause ESLint error):

```ts
// Truthiness guard: a real 0 becomes null
valuation: z.string().optional().transform((val) => (val ? +val : null)),

// Bare coercion: "" and "0" are indistinguishable
maxOrganizations: z.string().transform((val) => +val),

// Same trap, other spellings
count: z.string().transform((val) => Number(val)),
limit: z.string().transform((val) => parseInt(val, 10)),
```

✅ **Good** (passes ESLint):

```ts
valuation: optionalNumberFromString({ blank: null }),
maxOrganizations: requiredNumberFromString({ fieldName: "Max organizations" }),
```

✅ **Also good** (no coercion, never flagged):

```ts
z.string().transform((val) => val === "on"); // checkbox field
z.string().transform((val) => val.trim()); // text field
z.coerce.number().transform((val) => (Number.isNaN(val) ? undefined : val)); // guard
```

#### When does the rule trigger?

The rule triggers when:

1. The call is `.transform(...)`, matched by property name only (a zod chain spans many lines and is assembled from helpers, so proving the receiver statically is what would make this rule brittle)
2. The first argument is an arrow function with an **expression body**
3. Its first parameter is a plain identifier
4. That parameter is coerced somewhere in the body by `+val`, `Number(val)`, `parseInt(val)`, `parseFloat(val)`, `Number.parseInt(val)` or `Number.parseFloat(val)`

The report lands on the coercion itself, not on the whole `.transform()` call, so the squiggle points at the thing to replace.

#### When does the rule skip checking?

The rule does NOT flag:

1. **Coercion outside a `.transform()`**: `Number(csvValue)` in `app/utils/import-update-diff.ts` compares CSV cells against stored values, which is a different job
2. **A different value**: `.transform((val) => Number(somethingElse))` coerces something the callback did not receive
3. **Guards**: `Number.isNaN(val)` and `Number.isFinite(val)` return a boolean and coerce nothing
4. **Function references**: `.transform(Number)`, `.transform(toNumber)` carry no body to read at the call site
5. **Block bodies**: `.transform((val) => { ... })` can branch, reassign and return from several places, so the rule bails rather than risk a false positive
6. **Destructured or rest parameters**: `.transform(({ val }) => ...)` has no single name to match a coercion against
7. **Nested callbacks**: an inner function can rebind the parameter name, so its body is not walked
8. **`app/utils/zod-numeric.ts`**: the helper module coerces on purpose, after its own blank check, so that one file is exempt while every caller stays covered

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
