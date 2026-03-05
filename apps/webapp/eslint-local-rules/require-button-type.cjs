/**
 * ESLint rule to require explicit `type` prop on Button components
 * when rendering as a native <button> element.
 *
 * The HTML spec defaults button type to "submit", which can cause
 * accidental form submissions. This rule enforces explicit intent.
 *
 * Skips Button usage when:
 * - `to` prop is present (renders as Link)
 * - `as` prop is set to a non-"button" value (renders as <a>, <span>, etc.)
 *
 * ❌ Bad:
 * <Button onClick={handler}>Click</Button>
 * <Button variant="secondary">Cancel</Button>
 *
 * ✅ Good:
 * <Button type="button" onClick={handler}>Click</Button>
 * <Button type="submit">Save</Button>
 * <Button to="/home">Home</Button>
 * <Button as="a" href="...">Link</Button>
 */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Require explicit "type" prop on Button components rendering as native buttons',
      recommended: true,
    },
    schema: [],
    messages: {
      missingType:
        'Button is missing an explicit "type" prop. Add type="button", type="submit", or type="reset".',
    },
  },

  create(context) {
    // Track if Button is imported from @react-email (not our component)
    let isReactEmailButton = false;

    return {
      ImportDeclaration(node) {
        if (
          node.source.value === "@react-email/components" &&
          node.specifiers.some(
            (s) =>
              (s.type === "ImportSpecifier" && s.imported.name === "Button") ||
              s.type === "ImportDefaultSpecifier"
          )
        ) {
          isReactEmailButton = true;
        }
      },

      JSXOpeningElement(node) {
        // Only check <Button> components
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "Button") {
          return;
        }

        // Skip if Button comes from @react-email
        if (isReactEmailButton) {
          return;
        }

        const attributes = node.attributes;

        let hasType = false;
        let hasTo = false;
        let hasNonButtonAs = false;

        for (const attr of attributes) {
          // Skip spread attributes — we can't statically analyze them
          if (attr.type === "JSXSpreadAttribute") {
            return;
          }

          if (attr.type !== "JSXAttribute" || !attr.name) {
            continue;
          }

          const name = attr.name.name;

          if (name === "type") {
            hasType = true;
          }

          if (name === "to") {
            hasTo = true;
          }

          if (name === "as") {
            // Check if as is set to something other than "button"
            if (
              attr.value &&
              attr.value.type === "Literal" &&
              attr.value.value !== "button"
            ) {
              hasNonButtonAs = true;
            }
            // If as={SomeComponent} (expression), skip the check
            if (attr.value && attr.value.type === "JSXExpressionContainer") {
              hasNonButtonAs = true;
            }
          }
        }

        // Skip if it's a link button or uses a custom element/component
        if (hasTo || hasNonButtonAs) {
          return;
        }

        if (!hasType) {
          context.report({
            node,
            messageId: "missingType",
          });
        }
      },
    };
  },
};
