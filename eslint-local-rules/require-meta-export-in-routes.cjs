/**
 * ESLint rule to require `meta` export in Remix route files.
 *
 * This ensures all routes have proper page titles for better SEO and UX.
 * Each route should export a meta function that includes a title.
 *
 * ❌ Bad (route without meta export):
 * export function loader() { ... }
 *
 * ✅ Good:
 * export const meta: MetaFunction<typeof loader> = ({ data }) => [
 *   { title: data ? appendToMetaTitle(data.header.title) : "" },
 * ];
 */

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require `meta` export in Remix route files for proper page titles",
      category: "Best Practices",
      recommended: true,
    },
    messages: {
      missingMetaExport:
        "Route files should export a `meta` const with a title. " +
        "Example: export const meta: MetaFunction<typeof loader> = ({ data }) => [{ title: ... }];",
    },
    schema: [],
  },

  create(context) {
    // Only apply this rule to route files
    const filename = context.getFilename();
    if (!filename.includes("/app/routes/")) {
      return {};
    }

    // Skip test files
    if (filename.endsWith(".test.ts") || filename.endsWith(".test.tsx")) {
      return {};
    }

    let hasMetaExport = false;
    let hasLoaderOrAction = false;
    let hasDefaultExport = false;

    return {
      ExportNamedDeclaration(node) {
        // Check if this is a meta export
        if (node.declaration) {
          if (
            node.declaration.type === "VariableDeclaration" &&
            node.declaration.declarations.some(
              (decl) => decl.id.type === "Identifier" && decl.id.name === "meta"
            )
          ) {
            hasMetaExport = true;
          } else if (
            node.declaration.type === "FunctionDeclaration" &&
            node.declaration.id &&
            (node.declaration.id.name === "loader" ||
              node.declaration.id.name === "action")
          ) {
            hasLoaderOrAction = true;
          }
        }

        // Handle export const meta = ...
        if (
          node.specifiers &&
          node.specifiers.some(
            (spec) =>
              spec.type === "ExportSpecifier" && spec.exported.name === "meta"
          )
        ) {
          hasMetaExport = true;
        }
      },

      // Check for export function loader/action
      ExportAllDeclaration() {
        // Not relevant for this rule
      },

      // Check for default export (component)
      ExportDefaultDeclaration() {
        hasDefaultExport = true;
      },

      // At the end of the file, check if meta export exists
      "Program:exit"(node) {
        // Only warn if this is a route file with a component or loader/action
        // Skip if no default export and no loader/action (likely not a route file)
        if (!hasDefaultExport && !hasLoaderOrAction) {
          return;
        }

        if (!hasMetaExport) {
          context.report({
            node,
            messageId: "missingMetaExport",
          });
        }
      },
    };
  },
};
