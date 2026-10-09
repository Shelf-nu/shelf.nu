/**
 * RuleTester coverage for `require-archived-at-check-on-asset-queries`.
 *
 * Run via the normal webapp test runner: `pnpm webapp:test -- --run
 * eslint-local-rules/require-archived-at-check-on-asset-queries.test.cjs`.
 *
 * @see {@link file://./require-archived-at-check-on-asset-queries.cjs}
 */

const { RuleTester } = require("eslint");
const rule = require("./require-archived-at-check-on-asset-queries.cjs");

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const error = { messageId: "missingArchivedAtCheck" };

ruleTester.run("require-archived-at-check-on-asset-queries", rule, {
  valid: [
    // Active assets, the default.
    "db.asset.findMany({ where: { organizationId, archivedAt: null } })",
    // Deliberately archived ones.
    "tx.asset.count({ where: { id: { in: ids }, archivedAt: { not: null } } })",
    // A quoted key is the same property.
    'db.asset.findMany({ "where": { organizationId, "archivedAt": null } })',
    // Any client name: tx, _db, client.
    "client.asset.groupBy({ by: ['status'], where: { organizationId, archivedAt: null } })",
    // Both branches of a ternary say which side they read.
    "db.asset.findFirst({ where: cond ? { id, archivedAt: null } : { archivedAt: null } })",
    // A where built elsewhere is the builder's responsibility.
    "db.asset.findMany({ where: getAssetsWhereInput(params) })",
    "db.asset.findMany({ where })",
    // A spread may carry the filter; trusted, as it cannot be checked.
    "db.asset.findMany({ where: { ...scope, id } })",
    // Options built elsewhere are not checkable.
    "db.asset.findMany(args)",
    // Writes are not covered: the archived freeze guards them.
    "db.asset.updateMany({ where: { id }, data: { title } })",
    // Other models are not covered.
    "db.kit.findMany({ where: { organizationId } })",
    // A relation filter on another model is not an asset query.
    "db.bookingAsset.findMany({ where: { asset: { organizationId } } })",
  ],
  invalid: [
    {
      code: "db.asset.findMany({ where: { organizationId } })",
      errors: [error],
    },
    { code: "tx.asset.count({ where: { id: { in: ids } } })", errors: [error] },
    { code: "db.asset.findUniqueOrThrow({ where: { id } })", errors: [error] },
    {
      code: "db.asset.aggregate({ where: { organizationId }, _sum: { value: true } })",
      errors: [error],
    },
    // A quoted `where` is still checked.
    {
      code: 'db.asset.findMany({ "where": { organizationId } })',
      errors: [error],
    },
    // A computed key names nothing: `archivedAt` is not proven present.
    {
      code: "db.asset.findMany({ where: { [archivedAt]: null } })",
      errors: [error],
    },
    // No where at all reads every asset.
    { code: "db.asset.count()", errors: [error] },
    { code: "db.asset.findMany({ select: { id: true } })", errors: [error] },
    // Each ternary branch is checked on its own.
    {
      code: "db.asset.findFirst({ where: cond ? { id, archivedAt: null } : { id } })",
      errors: [error],
    },
  ],
});
