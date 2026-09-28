/**
 * ESLint rule banning hand-rolled numeric coercion inside a zod `.transform()`.
 *
 * `Number("")`, `Number("   ")` and `Number("0")` all return `0`, so a coercion
 * written inside `.transform()` has no way to tell an untouched form field from
 * a deliberate zero. The guards that get wrapped around it do not fix that:
 * `val ? +val : null` throws away a real `0`, and every value the guard does
 * let through is still coerced by the same blind rules.
 *
 * `optionalNumberFromString()` and `requiredNumberFromString()` in
 * `~/utils/zod-numeric` decide blank vs zero on the STRING, before any
 * coercion, and handle trimming and NaN along the way. Use them instead of
 * coercing by hand.
 *
 * The rule matches the CALL by property name (`.transform(...)`) alone. It does
 * not try to prove the receiver is a zod schema: those chains span many lines
 * and are assembled from helpers, so proving it statically is precisely what
 * would make this rule brittle. Coercing a callback parameter to a number by
 * hand is worth a second look wherever it happens.
 *
 * ❌ Bad:
 *   z.string().transform((val) => (val ? +val : null))
 *   z.string().transform((val) => Number(val))
 *   z.string().transform((val) => parseInt(val, 10))
 *
 * ✅ Good:
 *   optionalNumberFromString({ blank: null })
 *   requiredNumberFromString({ fieldName: "Count" })
 *
 * ✅ Good, no coercion at all, never flagged:
 *   z.string().transform((val) => val === "on")
 *   z.string().transform((val) => val.trim())
 *   z.coerce.number().transform((val) => (Number.isNaN(val) ? undefined : val))
 *
 * @see {@link file://../app/utils/zod-numeric.ts}
 * @see {@link file://../../../.claude/rules/blank-and-zero-are-different-answers.md}
 */

/** Bare callees that coerce their first argument to a number. */
const BARE_COERCION_CALLEES = new Set(["Number", "parseInt", "parseFloat"]);

/**
 * Members of `Number` that coerce their first argument to a number.
 *
 * `isNaN` and `isFinite` are deliberately absent: they are guards, they return
 * a boolean, and they coerce nothing. A `.transform()` whose only `Number.*`
 * call is one of those is correct as-is.
 */
const NUMBER_COERCION_MEMBERS = new Set(["parseInt", "parseFloat"]);

/** Keys on an ESLint AST node that never hold a child node worth walking. */
const NON_CHILD_KEYS = new Set(["parent", "loc", "range", "start", "end"]);

/**
 * Node types that open their own parameter scope, so a name inside them may
 * refer to something other than the `.transform()` parameter.
 */
const NESTED_FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);

/**
 * The module that owns the one sanctioned coercion.
 *
 * `optionalNumberFromString()` coerces only after its own blank check has
 * already decided whether the field was left empty, which is the entire point
 * of the helper. This rule cannot see that a guard ran, so the implementation is
 * exempt while every caller stays covered.
 */
const CANONICAL_HELPER_MODULE = "app/utils/zod-numeric.ts";

/** Is `filename` the module that owns the sanctioned coercion? */
function isCanonicalHelperModule(filename) {
  return (
    typeof filename === "string" &&
    filename.replace(/\\/g, "/").endsWith(CANONICAL_HELPER_MODULE)
  );
}

/** Is `node` the identifier `name`? */
function isIdentifierNamed(node, name) {
  return Boolean(node) && node.type === "Identifier" && node.name === name;
}

/**
 * Does `node` coerce `paramName` to a number by hand?
 *
 * Covers `+val`, `Number(val)`, `parseInt(val)`, `parseFloat(val)` and the
 * `Number.parseInt(val)` / `Number.parseFloat(val)` spellings. Only the first
 * argument is inspected, so a radix (or any further argument) is irrelevant.
 *
 * @param node - The AST node under consideration
 * @param paramName - The `.transform()` callback's parameter name
 * @returns `true` when this node coerces that parameter to a number
 */
function coercesParamToNumber(node, paramName) {
  if (node.type === "UnaryExpression") {
    return node.operator === "+" && isIdentifierNamed(node.argument, paramName);
  }

  if (node.type !== "CallExpression") return false;

  // Coercing anything other than the callback's own parameter is not this
  // rule's concern: a value read from elsewhere may genuinely be a number.
  if (!isIdentifierNamed(node.arguments[0], paramName)) return false;

  const callee = node.callee;

  if (callee.type === "Identifier") {
    return BARE_COERCION_CALLEES.has(callee.name);
  }

  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    isIdentifierNamed(callee.object, "Number") &&
    callee.property.type === "Identifier" &&
    NUMBER_COERCION_MEMBERS.has(callee.property.name)
  );
}

/**
 * Walk an expression for the first hand-rolled coercion of `paramName` and
 * return that node, so the report lands on the coercion itself rather than on
 * the whole `.transform()` call.
 *
 * Nested functions are not walked: an inner callback can rebind `paramName`,
 * and reporting a coercion of a different value that happens to share the name
 * would be a false positive. Skipping is the house stance.
 *
 * @param node - Any AST node (a plain value is ignored)
 * @param paramName - The `.transform()` callback's parameter name
 * @returns The offending node, or `null` when the expression is clean
 */
function findCoercionOfParam(node, paramName) {
  if (!node || typeof node.type !== "string") return null;
  if (coercesParamToNumber(node, paramName)) return node;
  if (NESTED_FUNCTION_TYPES.has(node.type)) return null;

  for (const key of Object.keys(node)) {
    if (NON_CHILD_KEYS.has(key)) continue;

    const value = node[key];

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findCoercionOfParam(item, paramName);
        if (found) return found;
      }
      continue;
    }

    if (value && typeof value === "object") {
      const found = findCoercionOfParam(value, paramName);
      if (found) return found;
    }
  }

  return null;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow coercing a zod .transform() callback parameter to a number by hand, which cannot tell a blank field from a deliberate zero",
      recommended: true,
    },
    schema: [],
    messages: {
      handCoercedNumericTransform:
        "Do not coerce a string to a number inside `.transform()`. " +
        '`Number("")`, `Number("   ")` and `Number("0")` are all `0`, so this ' +
        "cannot tell a blank field from a deliberate zero. Use " +
        "`optionalNumberFromString()` or `requiredNumberFromString()` from " +
        "`~/utils/zod-numeric`.",
    },
  },

  create(context) {
    // The helper module coerces on purpose, behind its own blank check.
    if (isCanonicalHelperModule(context.getFilename())) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;

        // Match `<anything>.transform(...)` by property name only, per the
        // note in the header.
        if (
          callee.type !== "MemberExpression" ||
          callee.computed ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "transform"
        ) {
          return;
        }

        const callback = node.arguments[0];
        if (!callback) return;

        // A function REFERENCE (`.transform(Number)`, `.transform(toNumber)`)
        // brings no body to read here, and a `function` expression always has a
        // block body, which is the next bail anyway. Only an arrow function can
        // carry an expression body this rule can inspect.
        if (callback.type !== "ArrowFunctionExpression") return;

        // A block body can branch, reassign and return from several places in
        // ways this rule cannot read. Skip rather than risk a false positive.
        if (callback.body.type === "BlockStatement") return;

        const parameter = callback.params[0];
        // A destructured, defaulted or rest parameter has no single name to
        // match a coercion against.
        if (!parameter || parameter.type !== "Identifier") return;

        const offender = findCoercionOfParam(callback.body, parameter.name);
        if (!offender) return;

        context.report({
          node: offender,
          messageId: "handCoercedNumericTransform",
        });
      },
    };
  },
};
