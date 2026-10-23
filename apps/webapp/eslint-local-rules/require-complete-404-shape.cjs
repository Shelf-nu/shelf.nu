/**
 * ESLint rule: require a complete workspace-switcher shape on 404 ShelfError
 * additionalData whenever a developer opts into it by setting `model`.
 *
 * `apps/webapp/app/components/errors/utils.ts` (`error404AdditionalDataSchema`)
 * parses `additionalData` as a discriminated union keyed on `model`. When
 * `model` is set but the sibling switcher field the schema needs is missing,
 * `error404AdditionalDataSchema.safeParse` fails and `parse404ErrorData`
 * silently falls back to the generic "something went wrong" error screen
 * instead of the organization-switcher UI — with no error surfaced anywhere,
 * because the parse failure is swallowed by `safeParse`.
 *
 * This rule does NOT require the switcher shape on every 404 — plenty of
 * genuine not-founds have no `model` at all (e.g. `{ id, organizationId }`)
 * and are correct as-is. It only fires once a developer has opted in by
 * setting `model` to one of the schema's known enum values.
 *
 * Required sibling key per model (matches the REAL working switcher throws,
 * e.g. `modules/asset/service.server.ts` — see note on `id` below):
 *   - "asset" | "kit" | "location" | "booking" | "customField" | "audit"
 *     → requires `organization`
 *   - "teamMember" → requires `organizations` (plural — a team member can
 *     belong to more than one of the caller's other organizations)
 *
 * NOTE ON `id`: `error404AdditionalDataSchema`'s base schema types `id` as
 * required (`z.string()`), and most resource-model switcher throws
 * (asset/location/customField/kit/booking/teamMember) omit it at the `throw`
 * site. This is NOT a schema bug: the surrounding `try/catch` that re-wraps
 * these errors merges `{ id, organizationId, ...cause.additionalData }`, so
 * the client-facing `additionalData` always regains `id` before it reaches
 * `parse404ErrorData` — the switcher renders correctly. This rule therefore
 * does NOT enforce `id` (the catch supplies it) and instead enforces
 * `organization` / `organizations`, which the catch does NOT inject and which
 * a developer must set at the throw site for the switcher to work.
 *
 * ❌ Bad — sets `model` but omits the sibling the schema needs for it:
 *   throw new ShelfError({
 *     status: 404,
 *     additionalData: { model: "asset", organizationId },
 *   });
 *
 * ✅ Good — complete switcher shape:
 *   throw new ShelfError({
 *     status: 404,
 *     additionalData: {
 *       model: "asset",
 *       organization: userOrganizations.find(...),
 *     },
 *   });
 *
 * ✅ Good — genuine not-found, no `model`, not our concern:
 *   throw new ShelfError({
 *     status: 404,
 *     additionalData: { id, organizationId },
 *   });
 */

/** Models whose schema branch requires a single `organization` object. */
const RESOURCE_MODELS = new Set([
  "asset",
  "kit",
  "location",
  "booking",
  "customField",
  "audit",
]);

/** The one model whose schema branch requires an `organizations` array. */
const TEAM_MEMBER_MODEL = "teamMember";

const KNOWN_MODELS = new Set([...RESOURCE_MODELS, TEAM_MEMBER_MODEL]);

/**
 * Find a direct (non-computed, non-spread) `Property` by key name on an
 * `ObjectExpression`. Returns `undefined` if not present as a direct
 * property (spread/computed properties are never matched here — callers
 * that need to tolerate those should check `hasSpread` separately).
 */
function findProperty(objectExpression, keyName) {
  return objectExpression.properties.find(
    (prop) =>
      prop.type === "Property" &&
      !prop.computed &&
      ((prop.key.type === "Identifier" && prop.key.name === keyName) ||
        (prop.key.type === "Literal" && prop.key.value === keyName))
  );
}

/** Does this object literal spread another value in? (`{ ...rest }`) */
function hasSpread(objectExpression) {
  return objectExpression.properties.some(
    (prop) => prop.type === "SpreadElement"
  );
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require the workspace-switcher sibling field (organization/organizations) whenever a 404 ShelfError's additionalData sets `model`",
      recommended: true,
    },
    schema: [],
    messages: {
      missingSwitcherField:
        '404 ShelfError additionalData sets model: "{{model}}" but is missing "{{missingKey}}". ' +
        "error404AdditionalDataSchema (apps/webapp/app/components/errors/utils.ts) requires " +
        '"{{missingKey}}" for this model — without it, parse404ErrorData silently fails and this ' +
        "404 falls back to the generic error screen instead of the organization-switcher UI. " +
        'Add "{{missingKey}}" to additionalData.',
    },
  },

  create(context) {
    return {
      NewExpression(node) {
        // Match: new ShelfError({ ... })
        if (
          node.callee.type !== "Identifier" ||
          node.callee.name !== "ShelfError"
        ) {
          return;
        }

        const arg = node.arguments[0];
        if (!arg || arg.type !== "ObjectExpression") return;

        // Only 404s are in scope.
        const statusProp = findProperty(arg, "status");
        if (
          !statusProp ||
          statusProp.value.type !== "Literal" ||
          statusProp.value.value !== 404
        ) {
          return;
        }

        const additionalDataProp = findProperty(arg, "additionalData");
        if (!additionalDataProp) return;

        const additionalData = additionalDataProp.value;
        // Spread/variable additionalData — can't statically verify, skip.
        if (additionalData.type !== "ObjectExpression") return;

        const modelProp = findProperty(additionalData, "model");
        // No `model` key at all — genuine not-found, not opted into the
        // switcher shape. Correct as-is.
        if (!modelProp) return;

        // Non-literal model (variable/expression) — can't statically verify.
        if (
          modelProp.value.type !== "Literal" ||
          typeof modelProp.value.value !== "string"
        ) {
          return;
        }

        const model = modelProp.value.value;
        // Not one of the schema's known discriminants — not our concern.
        if (!KNOWN_MODELS.has(model)) return;

        const requiredKey =
          model === TEAM_MEMBER_MODEL ? "organizations" : "organization";

        if (findProperty(additionalData, requiredKey)) return; // present, all good

        // The required key might be supplied via a spread we can't inspect
        // statically (e.g. `{ model: "asset", ...switcherFields }`) — treat
        // as safe rather than false-positive.
        if (hasSpread(additionalData)) return;

        context.report({
          node: additionalData,
          messageId: "missingSwitcherField",
          data: { model, missingKey: requiredKey },
        });
      },
    };
  },
};
