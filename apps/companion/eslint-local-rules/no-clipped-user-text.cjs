/**
 * ESLint rule: no clipped user-written text.
 *
 * A `<Text numberOfLines={n}>` cuts its text at n lines with nothing that
 * says more exists and no way to read the rest. That is fine for a name or a
 * label, but text a person typed (a description, a note, a comment) is often a
 * short multi-line list, so a few line breaks hide most of it. Render that
 * text with `ExpandableText` (`components/shared/expandable-text.tsx`), which
 * clips the same way and adds "Show more" only when the text overflows.
 *
 * Reports a `<Text>` with a `numberOfLines` prop whose children render an
 * identifier or member named description, note(s), comment(s), content or
 * message (any case). A `<Text>` inside a pressable (TouchableOpacity,
 * TouchableHighlight, TouchableWithoutFeedback, Pressable) is not reported: a
 * clipped preview on a card that opens the full item is the intended pattern.
 * `TextInput` is never reported: its `numberOfLines` sets the input height.
 *
 * ❌ `<Text numberOfLines={3}>{booking.description}</Text>`
 * ✅ `<ExpandableText text={booking.description} numberOfLines={3} />`
 * ✅ `<Pressable onPress={open}><Text numberOfLines={2}>{note.content}</Text></Pressable>`
 *
 * @see {@link file://../components/shared/expandable-text.tsx}
 */

/** Names of fields that hold free text a person typed. */
const USER_TEXT_NAME = /^(?:description|notes?|comments?|content|message)$/i;

/** Touchables whose children are a preview of something the tap opens. */
const PRESSABLES = new Set([
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "Pressable",
]);

/**
 * The name of a JSX element when it is a plain identifier (`<Text>`).
 *
 * @param {import("estree-jsx").JSXElement} element
 * @returns The element name, or `null` for member or namespaced names
 */
function elementName(element) {
  const name = element.openingElement.name;
  return name.type === "JSXIdentifier" ? name.name : null;
}

/**
 * The user-text field an expression renders, if any.
 *
 * Follows the branches of `a ?? b`, `a ? b : c`, optional chains and template
 * literals, since each of those renders the field's value.
 *
 * @param {import("estree").Expression} node
 * @returns The matched field name, or `null`
 */
function userTextField(node) {
  switch (node.type) {
    case "Identifier":
      return USER_TEXT_NAME.test(node.name) ? node.name : null;
    case "MemberExpression": {
      const property = node.property;
      const name =
        !node.computed && property.type === "Identifier"
          ? property.name
          : property.type === "Literal" && typeof property.value === "string"
          ? property.value
          : null;
      return name && USER_TEXT_NAME.test(name) ? name : null;
    }
    case "ChainExpression":
      return userTextField(node.expression);
    case "LogicalExpression":
      return userTextField(node.left) ?? userTextField(node.right);
    case "ConditionalExpression":
      return userTextField(node.consequent) ?? userTextField(node.alternate);
    case "TemplateLiteral":
      for (const expression of node.expressions) {
        const field = userTextField(expression);
        if (field) return field;
      }
      return null;
    default:
      return null;
  }
}

/**
 * Whether a node sits inside a pressable JSX element.
 *
 * @param {import("estree").Node} node
 */
function isInsidePressable(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "JSXElement" && PRESSABLES.has(elementName(current))) {
      return true;
    }
  }
  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow clipping user-written text with numberOfLines; use ExpandableText so the rest can be read",
      recommended: true,
    },
    schema: [],
    messages: {
      clippedUserText:
        "`{{field}}` is text a person typed; numberOfLines hides everything past the cut with no way to read it. Use ExpandableText from components/shared/expandable-text, which shows 'Show more' when the text overflows.",
    },
  },

  create(context) {
    return {
      JSXElement(node) {
        if (elementName(node) !== "Text") return;
        const clips = node.openingElement.attributes.some(
          (attribute) =>
            attribute.type === "JSXAttribute" &&
            attribute.name.name === "numberOfLines"
        );
        if (!clips) return;

        for (const child of node.children) {
          if (child.type !== "JSXExpressionContainer") continue;
          if (child.expression.type === "JSXEmptyExpression") continue;
          const field = userTextField(child.expression);
          if (!field) continue;
          if (isInsidePressable(node)) return;
          context.report({
            node: node.openingElement,
            messageId: "clippedUserText",
            data: { field },
          });
          return;
        }
      },
    };
  },
};
