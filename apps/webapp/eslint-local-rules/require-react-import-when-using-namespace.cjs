/**
 * ESLint rule to ensure the React namespace is imported when used.
 *
 * This catches cases where `React` is referenced (as a value or a type)
 * without a corresponding import, which can lead to runtime errors with
 * the automatic JSX runtime.
 *
 * ❌ Bad:
 * const MyComponent = () => React.createElement("div", null);
 *
 * ❌ Also bad:
 * type Props = { children: ReactNode };
 *
 * ✅ Good:
 * import React from "react";
 * const MyComponent = () => React.createElement("div", null);
 *
 * ✅ Also good:
 * import type React from "react";
 * type Props = { children: ReactNode };
 */

const ts = require("typescript");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require importing React when using the React namespace as a value or type",
      recommended: false,
    },
    schema: [],
    messages: {
      missingValueImport:
        'React is used as a value but is not imported. Add `import React from "react";` or import the React namespace.',
      missingTypeImport:
        'React is used as a type but is not imported. Add `import type React from "react";` (or a value import) before using React types.',
    },
  },

  create(context) {
    const reactValueUsages = [];
    const reactTypeUsages = [];

    let hasReactValueImport = false;
    let hasReactTypeImport = false;

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "react") {
          return;
        }

        const declarationKind = node.importKind === "type" ? "type" : "value";

        node.specifiers.forEach((specifier) => {
          if (
            (specifier.type === "ImportDefaultSpecifier" ||
              specifier.type === "ImportNamespaceSpecifier") &&
            specifier.local.name === "React"
          ) {
            const specifierKind =
              specifier.importKind === "type" ? "type" : declarationKind;

            if (specifierKind === "type") {
              hasReactTypeImport = true;
            } else {
              hasReactValueImport = true;
            }
          }
        });
      },

      Identifier(node) {
        if (node.name !== "React") {
          return;
        }

        if (isImportSpecifier(node)) {
          return;
        }

        if (isTypePosition(context, node)) {
          reactTypeUsages.push(node);
        } else {
          reactValueUsages.push(node);
        }
      },

      "Program:exit"() {
        if (!hasReactValueImport) {
          reactValueUsages.forEach((node) => {
            context.report({ node, messageId: "missingValueImport" });
          });
        }

        if (!hasReactValueImport && !hasReactTypeImport) {
          reactTypeUsages.forEach((node) => {
            context.report({ node, messageId: "missingTypeImport" });
          });
        }
      },
    };
  },
};

function isImportSpecifier(node) {
  const parentType = node.parent?.type;

  return (
    parentType === "ImportSpecifier" ||
    parentType === "ImportDefaultSpecifier" ||
    parentType === "ImportNamespaceSpecifier"
  );
}

function isTypePosition(context, node) {
  const services = context.parserServices;

  if (!services || !services.program) {
    return false;
  }

  const tsNode = services.esTreeNodeToTSNodeMap.get(node);

  let current = tsNode?.parent;

  while (current) {
    if (ts.isTypeNode(current) || ts.isTypeElement(current)) {
      return true;
    }

    if (ts.isExpression(current)) {
      return false;
    }

    current = current.parent;
  }

  return false;
}
