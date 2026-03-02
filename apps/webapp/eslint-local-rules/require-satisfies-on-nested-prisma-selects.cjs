/**
 * ESLint rule to require `satisfies` operator on getUserByID calls with select/include.
 *
 * This ensures TypeScript validates all Prisma select/include fields at compile time.
 * TypeScript's generic constraints don't perform strict property checking on wrapper functions,
 * so we need `satisfies` to force proper validation.
 *
 * ❌ Bad:
 * getUserByID(id, {
 *   select: { id: true, invalidField: true }
 * })
 *
 * ✅ Good:
 * getUserByID(id, {
 *   select: { id: true } satisfies Prisma.UserSelect
 * })
 */

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require `satisfies` operator on getUserByID calls with select/include for type safety",
      category: "Best Practices",
      recommended: true,
    },
    messages: {
      missingTypeSafety:
        "getUserByID with select/include must use 'satisfies Prisma.UserSelect' or 'satisfies Prisma.UserInclude' for type validation. " +
        "Add the satisfies operator after the options object.",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        // Check if this is a getUserByID call
        if (
          node.callee.type !== "Identifier" ||
          node.callee.name !== "getUserByID"
        ) {
          return;
        }

        // getUserByID should have 2 arguments: (id, options)
        if (node.arguments.length < 2) {
          return;
        }

        const optionsArg = node.arguments[1];

        // Check if the options argument is an object with select or include
        if (optionsArg.type !== "ObjectExpression") {
          return;
        }

        // Find the select or include property
        const selectOrIncludeProp = optionsArg.properties.find(
          (prop) =>
            prop.type === "Property" &&
            prop.key.type === "Identifier" &&
            (prop.key.name === "select" || prop.key.name === "include")
        );

        if (!selectOrIncludeProp) {
          return;
        }

        // Check if the select/include VALUE has a satisfies annotation
        const hasSatisfies = checkForSatisfies(
          selectOrIncludeProp.value,
          context
        );

        if (!hasSatisfies) {
          context.report({
            node: selectOrIncludeProp.value,
            messageId: "missingTypeSafety",
          });
        }
      },
    };
  },
};

/**
 * Check if the node is or has a TSTypeAssertion or TSSatisfiesExpression
 */
function checkForSatisfies(node, context) {
  const sourceCode = context.getSourceCode();

  // First check if the node itself is a TSSatisfiesExpression
  if (node.type === "TSSatisfiesExpression") {
    const typeAnnotation = sourceCode.getText(node.typeAnnotation);
    if (
      typeAnnotation.includes("Prisma.UserSelect") ||
      typeAnnotation.includes("Prisma.UserInclude") ||
      typeAnnotation.includes("Prisma.UserFindUniqueArgs")
    ) {
      return true;
    }
  }

  // Then walk up the tree looking for satisfies or as const satisfies
  let parent = node.parent;
  while (parent) {
    if (parent.type === "TSSatisfiesExpression") {
      // Check if it's satisfies Prisma.UserSelect or Prisma.UserInclude
      const typeAnnotation = sourceCode.getText(parent.typeAnnotation);
      if (
        typeAnnotation.includes("Prisma.UserSelect") ||
        typeAnnotation.includes("Prisma.UserInclude") ||
        typeAnnotation.includes("Prisma.UserFindUniqueArgs")
      ) {
        return true;
      }
    }

    // Also accept "as const satisfies" pattern
    if (parent.type === "TSAsExpression") {
      const nextParent = parent.parent;
      if (nextParent && nextParent.type === "TSSatisfiesExpression") {
        const typeAnnotation = sourceCode.getText(nextParent.typeAnnotation);
        if (
          typeAnnotation.includes("Prisma.UserSelect") ||
          typeAnnotation.includes("Prisma.UserInclude") ||
          typeAnnotation.includes("Prisma.UserFindUniqueArgs")
        ) {
          return true;
        }
      }
    }

    parent = parent.parent;
  }

  return false;
}
