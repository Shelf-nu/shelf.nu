---
description: Never compare organization roles directly, ask @shelf/permissions the named question
globs:
  [
    "apps/webapp/app/**/*.ts",
    "apps/webapp/app/**/*.tsx",
    "apps/companion/**/*.ts",
    "apps/companion/**/*.tsx",
  ]
---

# Role Checks Go Through `@shelf/permissions`

A role comparison decides for the roles it names and guesses for the rest: a
deny-list (`role === SELF_SERVICE || role === BASE`) treats any other role as
an admin, an allow-list (`roles.includes(ADMIN)`) treats it as restricted. Both
compile and pass tests, and they disagree the day a role is added.

Ask the question instead: matrix → `requirePermission` / `userHasPermission`;
reach → `access` (`requirePermission().access`, `useRoleAccess()`); owner →
`isWorkspaceOwner` / `access.ownsWorkspace`; Prisma audience →
`roles: { hasSome: rolesWhere((p) => …) }`; label → `ROLE_LABELS`.

```ts
// ❌ Bad
if (role === OrganizationRoles.SELF_SERVICE || role === OrganizationRoles.BASE) {…}
const label = organizationRolesMap[userOrg.roles[0]];
// ✅ Good
if (!access.bookings.writeAll) {…}
const label = ROLE_LABELS[resolveRole(userOrg.roles)];
```

Enforced by `local-rules/no-direct-role-checks` (webapp + companion); role
WRITES (`set: [newRole]`) are allowed. A new reach question gets a `RolePolicy`
field for every role, never a comparison. See `apps/docs/roles-and-permissions.md`.
