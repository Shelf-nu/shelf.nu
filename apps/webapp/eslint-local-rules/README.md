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

### `no-direct-role-checks`

**Purpose**: Every role decision goes through `@shelf/permissions`.

**Problem**: A role comparison decides for the roles it names and guesses for
the rest. A deny-list (`role === SELF_SERVICE || role === BASE`) treats any
other role as an admin; an allow-list (`roles.includes(ADMIN)`) treats it as
restricted. Both styles compile and pass tests, and they disagree silently as
soon as a role is added.

**Reports**: a role name (`"OWNER" | "ADMIN" | "SELF_SERVICE" | "BASE" |
"CUSTODY_MANAGER"` or `OrganizationRoles.X`, including aliases) used as an
operand of `===`/`!==`/`==`/`!=`, a `case` test, an argument of
`.includes/.indexOf/.lastIndexOf/.has/.some` (or an element of the array they
are called on), the value of a Prisma `has`, an element of a Prisma
`hasSome/hasEvery/in/notIn/equals` array, or one of two or more role keys of an
object literal; and any `roles[0]`.

**Not reported**: role writes (`roles: [OrganizationRoles.OWNER]`,
`set: [newRole]`), role names as object values, types.

**Allowed files**: `packages/permissions/**`, parity files, tests, `test/`,
mocks, factories, fixtures, and the effective-access probes.

#### Examples

❌ **Bad**:

```ts
if (
  role === OrganizationRoles.SELF_SERVICE ||
  role === OrganizationRoles.BASE
) {
}
where: {
  roles: {
    hasSome: [OrganizationRoles.OWNER, OrganizationRoles.ADMIN];
  }
}
const label = organizationRolesMap[userOrg.roles[0]];
```

✅ **Good**:

```ts
if (!access.bookings.writeAll) {
}
where: {
  roles: {
    hasSome: rolesWhere((p) => p.notifications.orgBookingBroadcasts);
  }
}
const label = ROLE_LABELS[resolveRole(userOrg.roles)];
```

Also enforced in `apps/companion` (its flat config imports this file).

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
