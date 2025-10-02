/**
 * ESLint rule to require `satisfies` operator on getUserByID calls with nested selects.
 *
 * This ensures TypeScript validates nested Prisma select fields at compile time.
 *
 * ❌ Bad:
 * getUserByID(id, {
 *   select: {
 *     qrCodes: { select: { id: true, invalidField: true } }
 *   }
 * })
 *
 * ✅ Good:
 * getUserByID(id, {
 *   select: {
 *     qrCodes: { select: { id: true } }
 *   }
 * } satisfies Prisma.UserSelect)
 */

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require `satisfies Prisma.UserSelect` on getUserByID calls with nested selects for type safety",
      category: "Best Practices",
      recommended: true,
    },
    messages: {
      missingTypeSafety:
        "getUserByID with nested select must use 'satisfies Prisma.UserSelect' for deep type validation. " +
        "Add '} satisfies Prisma.UserSelect)' or '} satisfies Prisma.UserInclude)' after the options object.",
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

        // Check if the select/include has nested properties (relations with their own select)
        const hasNestedSelect = hasNestedSelectOrInclude(
          selectOrIncludeProp.value
        );

        if (!hasNestedSelect) {
          return;
        }

        // Check if the options argument has a satisfies annotation
        const hasSatisfies = checkForSatisfies(optionsArg, context);

        if (!hasSatisfies) {
          context.report({
            node: optionsArg,
            messageId: "missingTypeSafety",
          });
        }
      },
    };
  },
};

/**
 * Check if an object expression has nested select or include (indicating relations)
 */
function hasNestedSelectOrInclude(node) {
  if (node.type !== "ObjectExpression") {
    return false;
  }

  return node.properties.some((prop) => {
    if (prop.type !== "Property" || prop.value.type !== "ObjectExpression") {
      return false;
    }

    // Check if this property's value has a 'select' or 'include' property
    return prop.value.properties.some(
      (innerProp) =>
        innerProp.type === "Property" &&
        innerProp.key.type === "Identifier" &&
        (innerProp.key.name === "select" || innerProp.key.name === "include")
    );
  });
}

/**
 * Check if the node has a TSTypeAssertion or TSSatisfiesExpression parent
 */
function checkForSatisfies(node, context) {
  const sourceCode = context.getSourceCode();
  let parent = node.parent;

  // Walk up the tree looking for satisfies or as const satisfies
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
