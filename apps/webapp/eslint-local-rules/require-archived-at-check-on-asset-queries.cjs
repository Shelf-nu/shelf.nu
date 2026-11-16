/**
 * ESLint rule to require an `archivedAt` filter on Asset read queries.
 *
 * Archived assets (issue #382) are out of service: hidden from lists, counts,
 * pickers and reports, and refused by bookings, kits and custody. A query that
 * forgets the filter quietly counts or offers them again, and nothing else
 * notices: typecheck passes and the result is still a valid list. So every
 * read on `<client>.asset` must say which side of the archive it wants.
 *
 * ❌ Bad:
 * db.asset.findMany({ where: { organizationId } })
 *
 * ✅ Good — active assets only (the default everywhere):
 * db.asset.findMany({ where: { organizationId, archivedAt: null } })
 *
 * ✅ Good — deliberately archived ones:
 * db.asset.findMany({ where: { organizationId, archivedAt: { not: null } } })
 *
 * ✅ Good — the query must reach archived assets too (a detail page, a
 * guard that reads the archive state, a history report). Say why:
 * // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: <reason>
 * db.asset.findFirst({ where: { id, organizationId } })
 *
 * A `where` built elsewhere (a variable, a helper call) is not checked: the
 * builder is responsible for it, as `getAssetsWhereInput` and
 * `applyArchivedFilter` are. A spread inside the literal is trusted the same
 * way. Writes are not covered; the archived freeze guards them.
 */

/** The Prisma read methods that take a `where`. */
const QUERY_METHODS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

/**
 * Whether `prop` is a plain property named `name`, written bare (`where`) or
 * quoted (`"where"`). A computed key (`[where]`) names nothing statically.
 *
 * @param {import("estree").Property | import("estree").SpreadElement} prop
 * @param {string} name
 * @returns {boolean}
 */
function isKeyNamed(prop, name) {
  if (prop.type !== "Property" || prop.computed) return false;
  if (prop.key.type === "Identifier") return prop.key.name === name;
  if (prop.key.type === "Literal") return prop.key.value === name;
  return false;
}

/**
 * Whether an object literal names `archivedAt`, directly or behind a spread
 * (which cannot be checked statically, so it is trusted).
 *
 * @param {import("estree").ObjectExpression} objectExpression
 * @returns {boolean}
 */
function hasArchivedAtProperty(objectExpression) {
  return objectExpression.properties.some(
    (prop) => prop.type === "SpreadElement" || isKeyNamed(prop, "archivedAt")
  );
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require an archivedAt filter on Asset read queries so archived assets are not included by accident",
      category: "Best Practices",
      recommended: true,
    },
    messages: {
      missingArchivedAtCheck:
        "Asset query must say which side of the archive it reads (issue #382). " +
        "Add 'archivedAt: null' for active assets, 'archivedAt: { not: null }' for archived ones, " +
        "or disable this rule on the line with a `-- why:` reason when the query must reach archived assets too.",
    },
    schema: [],
  },

  create(context) {
    /**
     * Reports `node` unless the `where` literal names `archivedAt`.
     *
     * @param {import("estree").Node} whereValue
     */
    function checkWhere(whereValue) {
      if (whereValue.type === "ConditionalExpression") {
        checkWhere(whereValue.consequent);
        checkWhere(whereValue.alternate);
        return;
      }
      // A where built elsewhere (variable, helper call): its builder owns it.
      if (whereValue.type !== "ObjectExpression") return;
      if (!hasArchivedAtProperty(whereValue)) {
        context.report({
          node: whereValue,
          messageId: "missingArchivedAtCheck",
        });
      }
    }

    return {
      CallExpression(node) {
        // Pattern: <client>.asset.<method>(...) — db, tx, _db, client, etc.
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.property.type !== "Identifier" ||
          !QUERY_METHODS.has(callee.property.name) ||
          callee.object.type !== "MemberExpression" ||
          callee.object.property.type !== "Identifier" ||
          callee.object.property.name !== "asset" ||
          callee.object.object.type !== "Identifier"
        ) {
          return;
        }

        const optionsArg = node.arguments[0];
        if (!optionsArg) {
          context.report({
            node: callee,
            messageId: "missingArchivedAtCheck",
          });
          return;
        }
        // Options built elsewhere: not statically checkable.
        if (optionsArg.type !== "ObjectExpression") return;

        const whereProp = optionsArg.properties.find((prop) =>
          isKeyNamed(prop, "where")
        );

        if (!whereProp) {
          // A spread of options may carry the where; trust it.
          if (optionsArg.properties.some((p) => p.type === "SpreadElement")) {
            return;
          }
          context.report({
            node: optionsArg,
            messageId: "missingArchivedAtCheck",
          });
          return;
        }

        checkWhere(whereProp.value);
      },
    };
  },
};
