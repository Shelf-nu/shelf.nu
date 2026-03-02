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
    let hasDefaultExport = false;

    return {
      ExportNamedDeclaration(node) {
        // Check if this is a meta export
        if (node.declaration) {
          // Check for: export const meta = ...
          if (
            node.declaration.type === "VariableDeclaration" &&
            node.declaration.declarations.some(
              (decl) => decl.id.type === "Identifier" && decl.id.name === "meta"
            )
          ) {
            hasMetaExport = true;
          }
          // Check for: export function meta(...) { ... }
          else if (
            node.declaration.type === "FunctionDeclaration" &&
            node.declaration.id &&
            node.declaration.id.name === "meta"
          ) {
            hasMetaExport = true;
          }
        }

        // Handle: export { meta }
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

      // Check for default export (component)
      ExportDefaultDeclaration() {
        hasDefaultExport = true;
      },

      // At the end of the file, check if meta export exists
      "Program:exit"(node) {
        // Only warn if this is a route file with a default export (page component)
        // Resource routes (without default export) don't need meta tags
        if (!hasDefaultExport) {
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
