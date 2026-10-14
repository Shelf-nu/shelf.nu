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
 * Reports a `<Text>` (or `<Animated.Text>`, any `<X.Text>`) with a
 * `numberOfLines` prop whose content renders an identifier or member named
 * description, note(s), comment(s), content or message (any case). The field
 * is found through `a ?? b`, `a ? b : c`, optional chains, template literals,
 * calls such as `stripMarkdown(note)` or `note.trim()`, the value a `.map()`
 * or `.flatMap()` callback returns (`notes.map((n) => n.content)`), and
 * nested `<Text>`.
 *
 * Not reported:
 * - A `numberOfLines` that can be unlimited (`0`, `undefined`, `null`, or a
 *   conditional with such a branch): that is a hand-rolled expandable text.
 * - A `<Text>` whose nearest pressable ancestor is a card that opens the full
 *   item: a pressable with an `onPress` that is not `Keyboard.dismiss`, and no
 *   scroll view between it and the text. A pressable that wraps a whole
 *   screen to dismiss the keyboard is not a card, so text inside it is checked.
 * - `TextInput`: its `numberOfLines` sets the input height.
 *
 * ❌ `<Text numberOfLines={3}>{booking.description}</Text>`
 * ✅ `<ExpandableText text={booking.description} numberOfLines={3} />`
 * ✅ `<Pressable onPress={open}><Text numberOfLines={2}>{note.content}</Text></Pressable>`
 *
 * @see {@link file://../components/shared/expandable-text.tsx}
 */

/** Names of fields that hold free text a person typed. */
const USER_TEXT_NAME = /^(?:description|notes?|comments?|content|message)$/i;

/** Touchables whose children can be a preview of something the tap opens. */
const PRESSABLES = new Set([
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "Pressable",
]);

/**
 * Containers that hold a screen's worth of content. A pressable above one of
 * these wraps a screen, not a card.
 */
const SCROLL_CONTAINERS = new Set([
  "ScrollView",
  "FlatList",
  "FlashList",
  "SectionList",
  "KeyboardAvoidingView",
  "KeyboardAwareScrollView",
]);

/**
 * The name of a JSX element: `Text` for `<Text>`, and the last segment for a
 * member name, so `<Animated.Text>` is also `Text`.
 *
 * @param {import("estree-jsx").JSXElement} element
 * @returns The element name, or `null` for namespaced names
 */
function elementName(element) {
  const name = element.openingElement.name;
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return name.property.name;
  return null;
}

/**
 * The value expression of a JSX attribute, or `null` when it has none.
 *
 * @param {import("estree-jsx").JSXOpeningElement} opening
 * @param {string} attributeName
 * @returns The attribute node and its expression, or `null` when absent
 */
function findAttribute(opening, attributeName) {
  for (const attribute of opening.attributes) {
    if (
      attribute.type === "JSXAttribute" &&
      attribute.name.name === attributeName
    ) {
      const value = attribute.value;
      const expression =
        value && value.type === "JSXExpressionContainer"
          ? value.expression
          : value;
      return { attribute, expression };
    }
  }
  return null;
}

/**
 * Whether a `numberOfLines` value can mean "no limit": `0`, `undefined`,
 * `null`, or a conditional with one of those as a branch.
 *
 * @param {import("estree").Expression | null} node
 */
function mayBeUnlimited(node) {
  if (!node) return false;
  switch (node.type) {
    case "Literal":
      return node.value === 0 || node.value === null;
    case "Identifier":
      return node.name === "undefined";
    case "ConditionalExpression":
      return mayBeUnlimited(node.consequent) || mayBeUnlimited(node.alternate);
    default:
      return false;
  }
}

/**
 * The user-text field an expression renders, if any.
 *
 * Follows the branches of `a ?? b`, `a ? b : c`, optional chains, template
 * literals and calls, since each of those renders the field's value.
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
      return firstField(node.expressions);
    case "ArrayExpression":
      // React renders each element of an array child.
      return firstField(node.elements.filter(Boolean));
    case "CallExpression": {
      // `note.trim()` renders `note`; `stripMarkdown(note)` renders it too.
      const callee = node.callee;
      const fromReceiver =
        callee.type === "MemberExpression"
          ? userTextField(callee.object)
          : null;
      return fromReceiver ?? mappedField(node) ?? firstField(node.arguments);
    }
    case "JSXElement":
    case "JSXFragment":
      // Nested `<Text>` and fragments lay out inside the clipped parent.
      if (node.type === "JSXElement" && elementName(node) !== "Text") {
        return null;
      }
      return childrenField(node.children);
    default:
      return null;
  }
}

/** Array methods whose callback's return value is what gets rendered. */
const MAPPING_METHODS = new Set(["map", "flatMap"]);

/**
 * The user-text field a `.map()` or `.flatMap()` callback returns, as in
 * `items.map((item) => item.description)`. Only these methods are followed:
 * a `.filter()` or `.find()` callback's value is not what gets rendered.
 *
 * @param {import("estree").CallExpression} node
 * @returns The matched field name, or `null`
 */
function mappedField(node) {
  const callee = node.callee;
  if (
    callee.type !== "MemberExpression" ||
    callee.computed ||
    !MAPPING_METHODS.has(callee.property.name)
  ) {
    return null;
  }
  const callback = node.arguments[0];
  if (
    !callback ||
    (callback.type !== "ArrowFunctionExpression" &&
      callback.type !== "FunctionExpression")
  ) {
    return null;
  }
  if (callback.body.type !== "BlockStatement") {
    return userTextField(callback.body);
  }
  // A block body renders whatever its return statements return.
  for (const statement of callback.body.body) {
    if (statement.type === "ReturnStatement" && statement.argument) {
      const field = userTextField(statement.argument);
      if (field) return field;
    }
  }
  return null;
}

/**
 * The first user-text field among a list of expressions.
 *
 * @param {Array<import("estree").Node>} nodes
 * @returns The matched field name, or `null`
 */
function firstField(nodes) {
  for (const node of nodes) {
    if (node.type === "SpreadElement") continue;
    const field = userTextField(node);
    if (field) return field;
  }
  return null;
}

/**
 * The first user-text field rendered by a list of JSX children.
 *
 * @param {Array<import("estree-jsx").JSXElement["children"][number]>} children
 * @returns The matched field name, or `null`
 */
function childrenField(children) {
  for (const child of children) {
    let field = null;
    if (child.type === "JSXExpressionContainer") {
      if (child.expression.type === "JSXEmptyExpression") continue;
      field = userTextField(child.expression);
    } else if (child.type === "JSXElement" || child.type === "JSXFragment") {
      field = userTextField(child);
    }
    if (field) return field;
  }
  return null;
}

/**
 * Whether an `onPress` value only dismisses the keyboard:
 * `Keyboard.dismiss` or `() => Keyboard.dismiss()`.
 *
 * @param {import("estree").Expression | null} node
 */
function isKeyboardDismiss(node) {
  if (!node) return false;
  if (
    node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    node.object.name === "Keyboard" &&
    node.property.type === "Identifier" &&
    node.property.name === "dismiss"
  ) {
    return true;
  }
  if (node.type === "ArrowFunctionExpression") {
    const body =
      node.body.type === "BlockStatement" && node.body.body.length === 1
        ? node.body.body[0].expression
        : node.body;
    return Boolean(
      body && body.type === "CallExpression" && isKeyboardDismiss(body.callee)
    );
  }
  return false;
}

/**
 * Whether a node sits inside a card that opens the full item: its nearest
 * pressable ancestor has a real `onPress`, and no scroll container lies
 * between the two.
 *
 * @param {import("estree").Node} node
 */
function isInsideOpeningCard(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type !== "JSXElement") continue;
    const name = elementName(current);
    if (SCROLL_CONTAINERS.has(name)) return false;
    if (!PRESSABLES.has(name)) continue;
    const onPress = findAttribute(current.openingElement, "onPress");
    return Boolean(onPress) && !isKeyboardDismiss(onPress.expression);
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
        const lines = findAttribute(node.openingElement, "numberOfLines");
        if (!lines || mayBeUnlimited(lines.expression)) return;

        const field = childrenField(node.children);
        if (!field || isInsideOpeningCard(node)) return;
        context.report({
          node: node.openingElement,
          messageId: "clippedUserText",
          data: { field },
        });
      },
    };
  },
};
