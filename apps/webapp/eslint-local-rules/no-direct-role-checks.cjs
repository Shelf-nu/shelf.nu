/**
 * ESLint rule: no direct organization-role checks.
 *
 * Role decisions live in `@shelf/permissions`: the permission matrix
 * (`userHasPermission` / `requirePermission`) and the role policy table
 * (`resolveRoleAccess` giving `access`, `isWorkspaceOwner`, `rolesWhere`). A
 * direct comparison answers only for the roles it names and guesses for the
 * rest: a deny-list (`role === SELF_SERVICE || role === BASE`) treats every
 * other role as an admin, an allow-list (`roles.includes(ADMIN)`) treats every
 * other role as restricted. Both compile, both pass tests, and they silently
 * disagree the moment a role is added.
 *
 * Reports role COMPARISONS only (see `meta.messages`). Role WRITES, such as
 * `roles: [OrganizationRoles.OWNER]` or `set: [newRole]`, are assignments, not
 * access decisions, and are never reported.
 *
 * ❌ `if (role === OrganizationRoles.SELF_SERVICE) …`
 * ✅ `if (access.custody.assign === "self") …`
 *
 * Also loaded by `apps/companion/eslint.config.js`, so the rule must keep
 * working under both ESLint 8 (webapp, eslintrc) and ESLint 9 (companion,
 * flat config): read `context.filename` with the `getFilename()` fallback.
 *
 * @see {@link file://../../../.claude/rules/role-checks-go-through-permissions.md}
 * @see {@link file://../../docs/roles-and-permissions.md}
 */

/** Every organization role name, as the Prisma enum spells it. */
const ROLE_NAMES = new Set([
  "OWNER",
  "ADMIN",
  "SELF_SERVICE",
  "BASE",
  "CUSTODY_MANAGER",
]);

/** Operators that compare a role against a value. */
const COMPARISON_OPERATORS = new Set(["===", "!==", "==", "!="]);

/** Methods that test whether a collection holds a role. */
const MEMBERSHIP_METHODS = new Set([
  "includes",
  "indexOf",
  "lastIndexOf",
  "has",
  "some",
]);

/** Prisma list filters whose array value names the roles to match. */
const PRISMA_LIST_FILTERS = new Set([
  "hasSome",
  "hasEvery",
  "in",
  "notIn",
  "equals",
]);

/** Files that may compare roles: the source of truth, parity guards, tests, fixtures. */
const ALLOWED_FILE_PATTERNS = [
  /(?:^|\/)packages\/permissions\//,
  /\.parity(?:\.test)?\.[cm]?[jt]sx?$/,
  /(?:^|\/)permission\.roles-parity(?:\.test)?\.[cm]?[jt]sx?$/,
  /\.(?:test|spec)(?:\.[^./]+)*\.[cm]?[jt]sx?$/,
  /(?:^|\/)(?:test|mocks|__mocks__|factories|fixtures)\//,
  /(?:^|\/)effective-access\.probes\.ts$/,
  /(?:^|\/)eslint-local-rules\//,
];

/**
 * Looks through TypeScript-only wrappers and optional chains.
 *
 * @param {import("estree").Node | null | undefined} node
 * @returns The innermost wrapped expression
 */
function unwrap(node) {
  let current = node;
  while (
    current &&
    (current.type === "TSAsExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "TSTypeAssertion" ||
      current.type === "ChainExpression")
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * The static name of a member property or object key, if it has one.
 *
 * @param node - The property or key node
 * @param computed - Whether the property or key is computed (`x[...]`)
 * @returns The name, or `null` when it is not statically known
 */
function staticName(node, computed) {
  if (!node) return null;
  if (!computed && node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct organization-role comparisons; ask @shelf/permissions the named question instead",
      recommended: true,
    },
    schema: [],
    messages: {
      roleComparison:
        "Don't compare organization roles directly. Ask the question you mean: userHasPermission / requirePermission for the matrix, `access` (requirePermission().access, useRoleAccess()) for reach, isWorkspaceOwner for ownership. A comparison silently decides for every role it does not name.",
      roleMembership:
        "Don't test role membership directly (.includes/.some/.has with a role name). Use userHasPermission, `access`, isWorkspaceOwner or holdsRoleWhere.",
      prismaRoleFilter:
        "Don't hard-code role names in a Prisma role filter. Build it from the policy table: `roles: { hasSome: rolesWhere((p) => …) }`.",
      perRoleLookup:
        "Don't key an object by organization role outside @shelf/permissions. Per-role data belongs in ROLE_POLICIES / ROLE_LABELS, where every role must have an entry.",
      positionalRole:
        "Don't read a membership's first role. `roles` is an array; use resolveRole(roles) (or `access.role`) for the effective role.",
    },
  },

  create(context) {
    const filename = (context.filename ?? context.getFilename()).replace(
      /\\/g,
      "/"
    );
    if (ALLOWED_FILE_PATTERNS.some((pattern) => pattern.test(filename))) {
      return {};
    }

    /** Local names bound to Prisma's `OrganizationRoles` enum. */
    const enumNames = new Set(["OrganizationRoles"]);

    /** Whether a node is an organization role name. */
    function isRoleName(raw) {
      const node = unwrap(raw);
      if (!node) return false;
      if (node.type === "MemberExpression") {
        const object = unwrap(node.object);
        if (
          !object ||
          object.type !== "Identifier" ||
          !enumNames.has(object.name)
        ) {
          return false;
        }
        const property = staticName(node.property, node.computed);
        return property !== null && ROLE_NAMES.has(property);
      }
      const literal = staticName(node, true);
      return literal !== null && ROLE_NAMES.has(literal);
    }

    /** Whether an expression is an array literal (or `new Set([...])`) naming a role. */
    function isRoleCollection(raw) {
      const node = unwrap(raw);
      if (!node) return false;
      if (node.type === "ArrayExpression") {
        return node.elements.some((element) => element && isRoleName(element));
      }
      if (
        node.type === "NewExpression" &&
        node.callee.type === "Identifier" &&
        node.callee.name === "Set" &&
        node.arguments.length > 0
      ) {
        return isRoleCollection(node.arguments[0]);
      }
      return false;
    }

    /** Whether a key of an object literal is a role name. */
    function isRoleKey(property) {
      if (property.type !== "Property") return false;
      if (property.computed) return isRoleName(property.key);
      const name = staticName(property.key, false);
      return name !== null && ROLE_NAMES.has(name);
    }

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@prisma/client") return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            staticName(specifier.imported, false) === "OrganizationRoles"
          ) {
            enumNames.add(specifier.local.name);
          }
        }
      },

      VariableDeclarator(node) {
        const init = unwrap(node.init);
        if (
          node.id.type === "Identifier" &&
          init &&
          init.type === "Identifier" &&
          enumNames.has(init.name)
        ) {
          enumNames.add(node.id.name);
        }
      },

      BinaryExpression(node) {
        if (!COMPARISON_OPERATORS.has(node.operator)) return;
        if (isRoleName(node.left) || isRoleName(node.right)) {
          context.report({ node, messageId: "roleComparison" });
        }
      },

      SwitchCase(node) {
        if (node.test && isRoleName(node.test)) {
          context.report({ node: node.test, messageId: "roleComparison" });
        }
      },

      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (!callee || callee.type !== "MemberExpression") return;
        const method = staticName(callee.property, callee.computed);
        if (!method || !MEMBERSHIP_METHODS.has(method)) return;
        if (
          node.arguments.some((argument) => isRoleName(argument)) ||
          isRoleCollection(callee.object)
        ) {
          context.report({ node, messageId: "roleMembership" });
        }
      },

      Property(node) {
        if (node.parent.type !== "ObjectExpression") return;
        const key = staticName(node.key, node.computed);
        if (key === "has" && isRoleName(node.value)) {
          context.report({ node, messageId: "prismaRoleFilter" });
          return;
        }
        if (
          key &&
          PRISMA_LIST_FILTERS.has(key) &&
          isRoleCollection(node.value)
        ) {
          context.report({ node, messageId: "prismaRoleFilter" });
        }
      },

      ObjectExpression(node) {
        if (node.properties.filter(isRoleKey).length >= 2) {
          context.report({ node, messageId: "perRoleLookup" });
        }
      },

      MemberExpression(node) {
        if (!node.computed) return;
        const index = unwrap(node.property);
        if (!index || index.type !== "Literal" || index.value !== 0) return;
        const object = unwrap(node.object);
        const name =
          object && object.type === "Identifier"
            ? object.name
            : object && object.type === "MemberExpression"
            ? staticName(object.property, object.computed)
            : null;
        if (name && /roles$/i.test(name)) {
          context.report({ node, messageId: "positionalRole" });
        }
      },
    };
  },
};
