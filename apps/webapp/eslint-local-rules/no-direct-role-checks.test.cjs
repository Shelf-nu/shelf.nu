/**
 * RuleTester coverage for `no-direct-role-checks`.
 *
 * Run via the webapp test runner:
 * `pnpm webapp:test -- --run eslint-local-rules/no-direct-role-checks.test.cjs`.
 *
 * @see {@link file://./no-direct-role-checks.cjs}
 */

const { RuleTester } = require("eslint");
const rule = require("./no-direct-role-checks.cjs");

const ruleTester = new RuleTester({
  parser: require.resolve("@typescript-eslint/parser"),
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const APP = "/repo/apps/webapp/app/modules/example/service.server.ts";
const IMPORT = `import { OrganizationRoles } from "@prisma/client";\n`;

ruleTester.run("no-direct-role-checks", rule, {
  valid: [
    // Role WRITES are assignments, not access decisions.
    {
      filename: APP,
      code: `${IMPORT}db.userOrganization.create({ data: { roles: [OrganizationRoles.OWNER] } });`,
    },
    {
      filename: APP,
      code: `db.userOrganization.update({ data: { roles: { set: [newRole] } } });`,
    },
    { filename: APP, code: `targetRoles.push(role);` },
    // Role names as VALUES of a column to role mapping.
    {
      filename: APP,
      code: `const SSO_GROUP_ROLE = { adminGroupId: "ADMIN", selfServiceGroupId: "SELF_SERVICE" };`,
    },
    // The platform super-admin enum is a different enum.
    { filename: APP, code: `if (role.name === Roles.ADMIN) {}` },
    { filename: APP, code: `if (role.name === Roles["ADMIN"]) {}` },
    // Asking the named question.
    { filename: APP, code: `if (!access.bookings.writeAll) {}` },
    {
      filename: APP,
      code: `roles: { hasSome: rolesWhere((p) => p.membership.ownsWorkspace) }`,
    },
    // Comparing two variables, types, and unrelated strings.
    { filename: APP, code: `if (selectedRole === currentRoleEnum) {}` },
    { filename: APP, code: `type R = "ADMIN" | "BASE";` },
    { filename: APP, code: `if (status === "DRAFT") {}` },
    { filename: APP, code: `where({ id: { in: ids } });` },
    { filename: APP, code: `const second = roles[1];` },
    // Allowlisted files.
    {
      filename: "/repo/packages/permissions/src/access.ts",
      code: `const owner = roles.includes("OWNER");`,
    },
    {
      filename:
        "/repo/apps/webapp/app/utils/permissions/permission.roles-parity.ts",
      code: `if (x === "ADMIN") {}`,
    },
    {
      filename:
        "/repo/apps/webapp/app/utils/permissions/booking-status.parity.ts",
      code: `if (x === "ADMIN") {}`,
    },
    {
      filename: "/repo/apps/webapp/app/modules/user/service.server.test.ts",
      code: `if (role === "ADMIN") {}`,
    },
    {
      filename: "/repo/apps/webapp/test/factories/user.ts",
      code: `if (role === "ADMIN") {}`,
    },
    {
      filename:
        "/repo/apps/webapp/app/utils/permissions/effective-access.probes.ts",
      code: `if (role === "SELF_SERVICE") {}`,
    },
    {
      filename: "/repo/apps/companion/lib/role-access.test.ts",
      code: `const r = roles[0];`,
    },
  ],

  invalid: [
    {
      filename: APP,
      code: `${IMPORT}if (role === OrganizationRoles.ADMIN) {}`,
      errors: [{ messageId: "roleComparison" }],
    },
    {
      filename: APP,
      code: `if ("OWNER" !== role) {}`,
      errors: [{ messageId: "roleComparison" }],
    },
    {
      filename: APP,
      code: `if (role === ("ADMIN" as const)) {}`,
      errors: [{ messageId: "roleComparison" }],
    },
    {
      filename: APP,
      code: `import { OrganizationRoles as OrgRolesEnum } from "@prisma/client";\nif (callerRole !== OrgRolesEnum.OWNER) {}`,
      errors: [{ messageId: "roleComparison" }],
    },
    {
      filename: APP,
      code: `${IMPORT}switch (role) { case OrganizationRoles.ADMIN: break; }`,
      errors: [{ messageId: "roleComparison" }],
    },
    {
      filename: APP,
      code: `const r = roles.includes("SELF_SERVICE");`,
      errors: [{ messageId: "roleMembership" }],
    },
    {
      filename: APP,
      code: `${IMPORT}const r = roles?.includes(OrganizationRoles.OWNER);`,
      errors: [{ messageId: "roleMembership" }],
    },
    {
      filename: APP,
      code: `const ok = ["OWNER", "ADMIN"].includes(role);`,
      errors: [{ messageId: "roleMembership" }],
    },
    {
      filename: APP,
      code: `const ok = new Set(["ADMIN"]).has(role);`,
      errors: [{ messageId: "roleMembership" }],
    },
    {
      filename: APP,
      code: `const i = roles.indexOf("BASE");`,
      errors: [{ messageId: "roleMembership" }],
    },
    {
      filename: APP,
      code: `${IMPORT}db.x.findMany({ where: { roles: { has: OrganizationRoles.OWNER } } });`,
      errors: [{ messageId: "prismaRoleFilter" }],
    },
    {
      filename: APP,
      code: `db.x.findMany({ where: { roles: { hasSome: ["ADMIN", "OWNER"] } } });`,
      errors: [{ messageId: "prismaRoleFilter" }],
    },
    {
      filename: APP,
      code: `${IMPORT}const RANK = { [OrganizationRoles.ADMIN]: 2, [OrganizationRoles.BASE]: 1 };`,
      errors: [{ messageId: "perRoleLookup" }],
    },
    {
      filename: APP,
      code: `const LABELS = { ADMIN: "Administrator", BASE: "Base" };`,
      errors: [{ messageId: "perRoleLookup" }],
    },
    {
      filename: APP,
      code: `const r = userOrg.roles[0];`,
      errors: [{ messageId: "positionalRole" }],
    },
    {
      filename: APP,
      code: `const r = currentOrganizationUserRoles?.[0];`,
      errors: [{ messageId: "positionalRole" }],
    },
    {
      filename: "/repo/apps/companion/app/(tabs)/bookings/[id].tsx",
      code: `const r = roles.some((x) => x === "BASE");`,
      errors: [{ messageId: "roleComparison" }],
    },
  ],
});
