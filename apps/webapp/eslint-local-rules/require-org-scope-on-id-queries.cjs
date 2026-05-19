/**
 * ESLint rule: require organizationId scoping on id-based Prisma queries.
 *
 * Shelf is multi-tenant. Querying an org-scoped model by `id` (or `id: { in }`)
 * WITHOUT also filtering by `organizationId` is a cross-org IDOR: a caller in
 * Org A can read/update/delete Org B's row by guessing/leaking its id.
 *
 * This rule only fires when BOTH are true:
 *   1. the model is org-scoped (has an `organizationId` field in schema.prisma), and
 *   2. the `where` clause filters by `id` but has no `organizationId` anywhere.
 *
 * Lookups by email / token / slug / qr-id (legitimate pre-org resolves like
 * auth, invites, QR scan) have no `id` key, so they never trigger.
 *
 * ❌ Bad:
 *   db.asset.findUnique({ where: { id } })
 *   tx.booking.updateMany({ where: { id: { in: ids } } })
 *
 * ✅ Good:
 *   db.asset.findFirst({ where: { id, organizationId } })
 *   tx.booking.updateMany({ where: { id: { in: ids }, organizationId } })
 *
 * ✅ Escape hatch (genuine pre-org / already-validated internal lookups):
 *   // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: <reason>
 *   db.asset.findUnique({ where: { id } })
 */

const fs = require("fs");
const path = require("path");

/**
 * Parse schema.prisma once and return the set of Prisma client accessor names
 * (camelCase model names) for models that declare an `organizationId` field.
 */
function loadOrgScopedModels() {
  const candidates = [
    path.resolve(__dirname, "../../../packages/database/prisma/schema.prisma"),
    path.resolve(__dirname, "../../packages/database/prisma/schema.prisma"),
  ];
  const schemaPath = candidates.find((p) => fs.existsSync(p));
  if (!schemaPath) return new Set();

  const src = fs.readFileSync(schemaPath, "utf8");
  const models = new Set();
  for (const match of src.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)) {
    const [, name, body] = match;
    // A scalar/relation field literally named organizationId
    if (/(^|\n)\s*organizationId\s/.test(body)) {
      models.add(name.charAt(0).toLowerCase() + name.slice(1));
    }
  }
  return models;
}

const ORG_SCOPED_MODELS = loadOrgScopedModels();

/**
 * Recursively check whether a where-tree node mentions a given property key.
 * Recurses through nested objects AND arrays so relational/logical Prisma
 * filters (`AND`/`OR`/`NOT: [{ organizationId }, ...]`) are detected — without
 * this, an org-scoped query using array filters is a false positive (and the
 * rule is `error`, so that would break the build).
 */
function hasKeyDeep(node, keyName) {
  if (!node) return true; // non-literal — can't verify, treat as safe
  if (node.type === "ArrayExpression") {
    return node.elements.some((el) => hasKeyDeep(el, keyName));
  }
  if (node.type !== "ObjectExpression") {
    // variable / spread / call — can't verify statically, treat as safe
    return true;
  }
  return node.properties.some((prop) => {
    if (prop.type === "SpreadElement") return true; // can't verify statically
    if (prop.type !== "Property" || prop.key.type !== "Identifier")
      return false;
    if (prop.key.name === keyName) return true;
    if (
      prop.value &&
      (prop.value.type === "ObjectExpression" ||
        prop.value.type === "ArrayExpression")
    ) {
      return hasKeyDeep(prop.value, keyName);
    }
    return false;
  });
}

/** Does this where filter by `id` (scalar or `id: { in: [...] }`)? */
function filtersById(objectExpression) {
  if (!objectExpression || objectExpression.type !== "ObjectExpression") {
    return false;
  }
  return objectExpression.properties.some(
    (prop) =>
      prop.type === "Property" &&
      prop.key.type === "Identifier" &&
      prop.key.name === "id"
  );
}

const QUERY_METHODS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
]);

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require organizationId scoping on id-based queries of org-scoped Prisma models (cross-org IDOR guard)",
      category: "Security",
      recommended: true,
    },
    messages: {
      missingOrgScope:
        "Cross-org IDOR risk: '{{model}}' is org-scoped but this query filters by 'id' " +
        "without 'organizationId'. Add 'organizationId' to the where clause (use findFirst " +
        "instead of findUnique if needed), or prefer a shared guard from " +
        "~/utils/org-validation.server. If this is a legitimate pre-org/internal lookup, add: " +
        "// eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: <reason>",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        // Match: <db|tx|_db>.<model>.<method>(...)
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.object.type !== "MemberExpression" ||
          callee.object.property.type !== "Identifier" ||
          callee.object.object.type !== "Identifier"
        ) {
          return;
        }

        const root = callee.object.object.name;
        if (root !== "db" && root !== "tx" && root !== "_db") return;

        const model = callee.object.property.name;
        if (!ORG_SCOPED_MODELS.has(model)) return;

        const method = callee.property.name;
        if (!QUERY_METHODS.has(method)) return;

        const optionsArg = node.arguments[0];
        if (!optionsArg || optionsArg.type !== "ObjectExpression") return;

        const whereProp = optionsArg.properties.find(
          (p) =>
            p.type === "Property" &&
            p.key.type === "Identifier" &&
            p.key.name === "where"
        );
        if (!whereProp) return;

        // Handle ternary where: cond ? {...} : {...}
        const branches =
          whereProp.value.type === "ConditionalExpression"
            ? [whereProp.value.consequent, whereProp.value.alternate]
            : [whereProp.value];

        for (const branch of branches) {
          if (branch.type !== "ObjectExpression") continue; // variable — skip
          if (!filtersById(branch)) continue; // not an id lookup — not our concern
          if (hasKeyDeep(branch, "organizationId")) continue; // properly scoped

          context.report({
            node: branch,
            messageId: "missingOrgScope",
            data: { model },
          });
        }
      },
    };
  },
};
