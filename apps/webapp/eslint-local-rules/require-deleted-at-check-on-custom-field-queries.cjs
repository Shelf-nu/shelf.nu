/**
 * ESLint rule to require deletedAt filter on CustomField queries.
 *
 * Ensures developers don't forget to filter out soft-deleted custom fields.
 * All queries on `db.customField` or `tx.customField` must include deletedAt in the where clause.
 *
 * ❌ Bad:
 * db.customField.findMany({
 *   where: { organizationId }
 * })
 *
 * ✅ Good:
 * db.customField.findMany({
 *   where: { organizationId, deletedAt: null }
 * })
 *
 * ✅ Also Good (in transactions):
 * tx.customField.findFirst({
 *   where: { id, organizationId, deletedAt: null }
 * })
 */

/**
 * Helper function to check if an ObjectExpression has a deletedAt property
 */
function hasDeletedAtProperty(objectExpression) {
  return objectExpression.properties.some((prop) => {
    if (prop.type === "Property" && prop.key.type === "Identifier") {
      return prop.key.name === "deletedAt";
    }
    if (prop.type === "SpreadElement") {
      // If spreading an object, we can't statically verify - assume it's ok
      return true;
    }
    return false;
  });
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require deletedAt filter on CustomField queries to avoid including soft-deleted fields",
      category: "Best Practices",
      recommended: true,
    },
    messages: {
      missingDeletedAtCheck:
        "CustomField query must include 'deletedAt' in the where clause to filter out soft-deleted fields. " +
        "Add 'deletedAt: null' to the where object, or 'deletedAt: { not: null }' if querying for deleted fields.",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        // Check if this is a customField query
        // Pattern: db.customField.findMany() or tx.customField.findFirst() etc.
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.object.type !== "MemberExpression" ||
          node.callee.object.property.type !== "Identifier" ||
          node.callee.object.property.name !== "customField"
        ) {
          return;
        }

        // Check if the parent object is 'db' or 'tx' (transaction)
        const dbIdentifier = node.callee.object.object;
        if (
          dbIdentifier.type !== "Identifier" ||
          (dbIdentifier.name !== "db" &&
            dbIdentifier.name !== "tx" &&
            dbIdentifier.name !== "_db")
        ) {
          return;
        }

        // Check if this is a query method that requires where clause
        const methodName = node.callee.property.name;
        const queryMethods = [
          "findMany",
          "findFirst",
          "findUnique",
          "findUniqueOrThrow",
          "findFirstOrThrow",
          "count",
          "aggregate",
        ];

        if (!queryMethods.includes(methodName)) {
          return;
        }

        // Get the first argument (options object)
        if (node.arguments.length === 0) {
          // No where clause at all - report error
          context.report({
            node: node.callee,
            messageId: "missingDeletedAtCheck",
          });
          return;
        }

        const optionsArg = node.arguments[0];

        // Check if the options argument is an object
        if (optionsArg.type !== "ObjectExpression") {
          return;
        }

        // Find the where property
        const whereProp = optionsArg.properties.find(
          (prop) =>
            prop.type === "Property" &&
            prop.key.type === "Identifier" &&
            prop.key.name === "where"
        );

        if (!whereProp) {
          // No where clause - report error
          context.report({
            node: optionsArg,
            messageId: "missingDeletedAtCheck",
          });
          return;
        }

        // Check if the where object includes deletedAt
        // Handle conditional expressions (ternary operators)
        if (whereProp.value.type === "ConditionalExpression") {
          // Check both branches of the ternary
          const consequent = whereProp.value.consequent;
          const alternate = whereProp.value.alternate;

          // Check consequent (true branch)
          if (
            consequent.type === "ObjectExpression" &&
            !hasDeletedAtProperty(consequent)
          ) {
            context.report({
              node: consequent,
              messageId: "missingDeletedAtCheck",
            });
          }

          // Check alternate (false branch)
          if (
            alternate.type === "ObjectExpression" &&
            !hasDeletedAtProperty(alternate)
          ) {
            context.report({
              node: alternate,
              messageId: "missingDeletedAtCheck",
            });
          }
          return;
        }

        if (whereProp.value.type !== "ObjectExpression") {
          // Where is not an object literal (could be a variable) - we can't check it statically
          // Skip this case to avoid false positives
          return;
        }

        const hasDeletedAt = hasDeletedAtProperty(whereProp.value);

        if (!hasDeletedAt) {
          context.report({
            node: whereProp.value,
            messageId: "missingDeletedAtCheck",
          });
        }
      },
    };
  },
};
