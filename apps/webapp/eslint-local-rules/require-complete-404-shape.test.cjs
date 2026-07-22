/**
 * RuleTester coverage for `require-complete-404-shape`.
 *
 * No other local rule in this repo had a RuleTester harness wired up yet, so
 * this file also establishes the pattern (parser + parserOptions needed for
 * modern syntax) for future local-rule tests.
 *
 * Run via the normal webapp test runner: `pnpm webapp:test -- --run
 * eslint-local-rules/require-complete-404-shape.test.cjs`. Vitest's
 * `globals: true` config exposes `describe`/`it` as real globals, which is
 * what ESLint's RuleTester auto-detects to run its cases.
 */

const { RuleTester } = require("eslint");
const rule = require("./require-complete-404-shape.cjs");

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("require-complete-404-shape", rule, {
  valid: [
    // No `model` at all — genuine not-found, correct as-is.
    {
      code: `
        throw new ShelfError({
          status: 404,
          additionalData: { id, organizationId },
        });
      `,
    },
    // Resource model with the required `organization` sibling present.
    {
      code: `
        throw new ShelfError({
          status: 404,
          additionalData: {
            model: "asset",
            organization: userOrganizations.find((o) => o.organizationId === assetOrgId),
            redirectTo,
          },
        });
      `,
    },
    // teamMember with the required `organizations` (plural) sibling present.
    {
      code: `
        throw new ShelfError({
          status: 404,
          additionalData: { model: "teamMember", organizations: otherOrgsForUser },
        });
      `,
    },
    // Non-404 status — not our concern regardless of shape.
    {
      code: `
        throw new ShelfError({
          status: 500,
          additionalData: { model: "asset" },
        });
      `,
    },
    // additionalData built from a variable — can't statically verify, skip.
    {
      code: `
        throw new ShelfError({ status: 404, additionalData: buildData() });
      `,
    },
    // additionalData spreads in the switcher fields — can't rule out the
    // required key being present, skip rather than false-positive.
    {
      code: `
        throw new ShelfError({
          status: 404,
          additionalData: { model: "kit", ...switcherFields },
        });
      `,
    },
    // Unknown/non-literal model value — can't statically verify.
    {
      code: `
        throw new ShelfError({
          status: 404,
          additionalData: { model: someVariable },
        });
      `,
    },
  ],

  invalid: [
    // Resource model missing `organization`.
    {
      code: `
        throw new ShelfError({
          status: 404,
          additionalData: { model: "asset", organizationId },
        });
      `,
      errors: [
        {
          messageId: "missingSwitcherField",
          data: { model: "asset", missingKey: "organization" },
        },
      ],
    },
    // teamMember missing `organizations`.
    {
      code: `
        throw new ShelfError({
          status: 404,
          additionalData: { model: "teamMember", id },
        });
      `,
      errors: [
        {
          messageId: "missingSwitcherField",
          data: { model: "teamMember", missingKey: "organizations" },
        },
      ],
    },
    // Every resource model shares the same required sibling.
    {
      code: `
        throw new ShelfError({
          status: 404,
          additionalData: { model: "booking" },
        });
      `,
      errors: [
        {
          messageId: "missingSwitcherField",
          data: { model: "booking", missingKey: "organization" },
        },
      ],
    },
  ],
});
