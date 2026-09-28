/**
 * RuleTester coverage for `no-hand-coerced-numeric-transform`.
 *
 * The invalid cases are the shapes that exist in this repo today (asset form
 * valuation, asset-model form, bulk-create count, the admin-dashboard
 * maxOrganizations field). The valid cases pin the three ways the rule must
 * stay quiet: coercion outside a `.transform()`, a `.transform()` that coerces
 * something other than its own parameter, and a `.transform()` this rule cannot
 * read statically.
 *
 * Run via the normal webapp test runner: `pnpm webapp:test -- --run
 * eslint-local-rules/no-hand-coerced-numeric-transform.test.cjs`.
 *
 * @see {@link file://./no-hand-coerced-numeric-transform.cjs}
 */

const { RuleTester } = require("eslint");
const rule = require("./no-hand-coerced-numeric-transform.cjs");

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-hand-coerced-numeric-transform", rule, {
  valid: [
    // Coercion OUTSIDE any `.transform()`. These are the real shapes in
    // app/utils/import-update-diff.ts and app/utils/note-sanitizer.server.ts,
    // which compare CSV cells against stored values and are correct as-is.
    { code: `const csvNum = Number(normalized);` },
    { code: `const currentNum = currentStr ? Number(currentStr) : NaN;` },
    { code: `const n = parseFloat(normalizeDecimalString(csvValue));` },
    { code: `const count = Number.parseInt(attrs.count ?? "0", 10);` },
    // Coercion inside a callback that is not a `.transform()`.
    { code: `const nums = rows.map((row) => Number(row));` },

    // Coerces something that is NOT the callback's parameter.
    { code: `schema.transform((val) => Number(someOtherThing));` },
    {
      code: `schema.transform((val) => (val ? Number(fallbackCount) : null));`,
    },

    // No coercion at all. Both shapes are common in this repo: checkbox
    // fields ("on") and trimmed text fields.
    { code: `z.string().transform((val) => (val === "on" ? true : false));` },
    { code: `z.string().transform((val) => val === "on");` },
    { code: `z.string().transform((val) => val.trim());` },
    { code: `z.string().transform((val) => (val ? val : null));` },
    { code: `z.string().transform((email) => email.toLowerCase());` },

    // `Number.isNaN` / `Number.isFinite` are guards, not coercion.
    {
      code: `z.coerce.number().transform((val) => (Number.isNaN(val) ? undefined : val));`,
    },
    {
      code: `z.coerce.number().transform((val) => (Number.isFinite(val) ? val : null));`,
    },

    // Not statically inspectable: a function reference brings no body here.
    { code: `z.string().transform(Number);` },
    { code: `z.string().transform(toNumber);` },
    { code: `z.union([z.string(), z.number()]).transform(Number);` },

    // Not statically inspectable: a block body can branch and return from
    // several places, so the rule bails.
    {
      code: `
        z.string().transform((val) => {
          if (!val) return null;
          return +val;
        });
      `,
    },
    {
      code: `
        z.string().transform(function (val) {
          return Number(val);
        });
      `,
    },

    // A destructured parameter has no single name to match against.
    { code: `schema.transform(({ val }) => Number(val));` },

    // `.transform` called with something that is not a callback at all
    // (app/utils/client-hints.tsx does this).
    { code: `acc[hintName] = hint.transform(getCookieValue(cookieString));` },

    // Computed access is not the `.transform()` this rule is about.
    { code: `schema[method]((val) => Number(val));` },

    // A coercion inside a NESTED callback may be a different `val` entirely.
    { code: `schema.transform((val) => val.map((val) => Number(val)));` },

    // The helper module itself coerces on purpose, behind its own blank check,
    // so the rule skips that one file while every caller stays covered.
    {
      code: `
        numericFieldText.transform((value) =>
          isBlank(value) ? blank : Number(value)
        );
      `,
      filename: "/repo/apps/webapp/app/utils/zod-numeric.ts",
    },
  ],

  invalid: [
    // Unary plus behind a truthiness guard: app/components/assets/form.tsx and
    // app/components/asset-model/form.tsx.
    {
      code: `
        const schema = z
          .string()
          .optional()
          .transform((val) => (val ? +val : null));
      `,
      errors: [
        { messageId: "handCoercedNumericTransform", type: "UnaryExpression" },
      ],
    },
    // Unary plus behind a blank-string guard.
    {
      code: `
        const schema = z
          .string()
          .optional()
          .transform((val) => (val === "" || val === undefined ? undefined : +val));
      `,
      errors: [
        { messageId: "handCoercedNumericTransform", type: "UnaryExpression" },
      ],
    },
    // Bare unary plus.
    {
      code: `z.string().transform((val) => +val);`,
      errors: [
        { messageId: "handCoercedNumericTransform", type: "UnaryExpression" },
      ],
    },
    // `Number(val)` behind a guard, with `Number.NaN` in the other branch.
    // `Number.NaN` is a property read, so only the call is reported.
    {
      code: `
        const schema = z
          .string()
          .transform((val) => (val === "" || val === undefined ? Number.NaN : Number(val)));
      `,
      errors: [
        { messageId: "handCoercedNumericTransform", type: "CallExpression" },
      ],
    },
    // Bare `Number(val)`.
    {
      code: `z.string().transform((val) => Number(val));`,
      errors: [
        { messageId: "handCoercedNumericTransform", type: "CallExpression" },
      ],
    },
    // `parseInt` with and without a radix.
    {
      code: `z.string().transform((val) => parseInt(val, 10));`,
      errors: [
        { messageId: "handCoercedNumericTransform", type: "CallExpression" },
      ],
    },
    {
      code: `z.string().transform((val) => parseInt(val));`,
      errors: [
        { messageId: "handCoercedNumericTransform", type: "CallExpression" },
      ],
    },
    // The `Number.parseInt` spelling.
    {
      code: `z.string().transform((val) => Number.parseInt(val, 10));`,
      errors: [
        { messageId: "handCoercedNumericTransform", type: "CallExpression" },
      ],
    },
    // `parseFloat`, both spellings.
    {
      code: `z.string().transform((val) => parseFloat(val));`,
      errors: [
        { messageId: "handCoercedNumericTransform", type: "CallExpression" },
      ],
    },
    {
      code: `z.string().transform((val) => Number.parseFloat(val));`,
      errors: [
        { messageId: "handCoercedNumericTransform", type: "CallExpression" },
      ],
    },
    // The parameter name is whatever the author chose.
    {
      code: `z.string().transform((value) => Number(value));`,
      errors: [
        { messageId: "handCoercedNumericTransform", type: "CallExpression" },
      ],
    },
    // A second parameter (`ctx`) changes nothing.
    {
      code: `z.string().transform((val, ctx) => +val);`,
      errors: [
        { messageId: "handCoercedNumericTransform", type: "UnaryExpression" },
      ],
    },
    // Inside an object literal schema, which is where most of these live.
    {
      code: `
        const schema = z.object({
          maxOrganizations: z.string().transform((val) => +val),
        });
      `,
      errors: [
        { messageId: "handCoercedNumericTransform", type: "UnaryExpression" },
      ],
    },
  ],
});
