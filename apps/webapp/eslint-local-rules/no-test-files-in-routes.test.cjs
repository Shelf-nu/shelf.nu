/**
 * RuleTester coverage for `no-test-files-in-routes`.
 *
 * The rule keys off the FILENAME rather than the AST, so every case supplies
 * an explicit `filename` and the `code` is irrelevant boilerplate.
 *
 * Run via the normal webapp test runner: `pnpm webapp:test -- --run
 * eslint-local-rules/no-test-files-in-routes.test.cjs`.
 *
 * @see {@link file://./no-test-files-in-routes.cjs}
 */

const { RuleTester } = require("eslint");
const rule = require("./no-test-files-in-routes.cjs");

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const CODE = `const x = 1; export default x;`;

ruleTester.run("no-test-files-in-routes", rule, {
  valid: [
    // The sanctioned home for route tests.
    {
      code: CODE,
      filename:
        "/repo/apps/webapp/test/routes-tests/api+/mobile+/qr.claim.test.ts",
    },
    // A real route module co-located in app/routes/ — the whole point.
    {
      code: CODE,
      filename: "/repo/apps/webapp/app/routes/api+/mobile+/qr.claim.ts",
    },
    // A route whose NAME contains "test" but which is not a test file.
    {
      code: CODE,
      filename:
        "/repo/apps/webapp/app/routes/_layout+/admin-dashboard+/test-supabase-rls.tsx",
    },
    // Co-located tests are fine everywhere EXCEPT app/routes/.
    {
      code: CODE,
      filename: "/repo/apps/webapp/app/modules/asset/service.server.test.ts",
    },
    {
      code: CODE,
      filename: "/repo/apps/webapp/app/utils/date-format.test.ts",
    },
    // No filename (RuleTester default) must not crash the rule.
    { code: CODE },
  ],

  invalid: [
    // The exact shape that broke the dev server (commit 458ecf2de).
    {
      code: CODE,
      filename: "/repo/apps/webapp/app/routes/api+/mobile+/qr.claim.test.ts",
      errors: [
        {
          messageId: "testFileInRoutes",
          data: { suggested: "api+/mobile+/qr.claim.test.ts" },
        },
      ],
    },
    // The `.test.server.ts` spelling is banned too — the `.server` infix only
    // ever existed to dodge the warmup glob, and the suggestion drops it.
    {
      code: CODE,
      filename:
        "/repo/apps/webapp/app/routes/api+/model-filters.test.server.ts",
      errors: [
        {
          messageId: "testFileInRoutes",
          data: { suggested: "api+/model-filters.test.ts" },
        },
      ],
    },
    // Route params / .spec / .tsx variants.
    {
      code: CODE,
      filename: "/repo/apps/webapp/app/routes/api+/mobile+/qr.$qrId.test.ts",
      errors: [{ messageId: "testFileInRoutes" }],
    },
    {
      code: CODE,
      filename: "/repo/apps/webapp/app/routes/_layout+/bookings.spec.tsx",
      errors: [{ messageId: "testFileInRoutes" }],
    },
    // Repo-relative paths (how ESLint reports staged files under lefthook).
    {
      code: CODE,
      filename: "app/routes/api+/audits.start.test.ts",
      errors: [{ messageId: "testFileInRoutes" }],
    },
  ],
});
