/**
 * Mobile Asset Create API
 *
 * Endpoint backing the companion app's quick-create flow. Mirrors the webapp's
 * create form contract: enforces required custom fields for the chosen
 * category, validates submitted custom-field values against the canonical
 * type/shape, and produces a fully persisted asset via `createAsset`.
 *
 * Security notes:
 * - `categoryId` is verified against the caller's organization before it is
 *   used to filter active custom fields (prevents cross-org probing).
 * - Submitted custom-field ids are intersected with the active definitions
 *   so unknown ids fail fast (HTTP 400) rather than reaching the persistence
 *   helper.
 *
 * @see {@link file://./../../../utils/custom-fields.ts} — `buildCustomFieldValue`, `extractCustomFieldValuesFromPayload`
 * @see {@link file://./../../../modules/custom-field/service.server.ts} — `getActiveCustomFields`
 * @see {@link file://./../../../modules/asset/service.server.ts} — `createAsset`
 */
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { buildMobileCustomFieldPayload } from "~/modules/api/mobile-custom-fields.server";
import { createAsset } from "~/modules/asset/service.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { extractCustomFieldValuesFromPayload } from "~/utils/custom-fields";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/asset/create
 *
 * Quick asset creation from mobile.
 * Title is required. QR code is auto-generated. If the chosen category has
 * any custom fields with `required: true`, the caller MUST submit a value
 * for each — otherwise the request is rejected with HTTP 400 and the names
 * of the missing fields. Mirrors the webapp create form's contract.
 *
 * Body: {
 *   title: string (required, min 2 chars)
 *   description?: string
 *   categoryId?: string
 *   locationId?: string
 *   valuation?: number
 *   customFields?: { id: string; value: string | number | boolean | null }[]
 * }
 *
 * @param args - React Router action args (carrying the incoming request).
 * @returns A JSON response with the created asset's id/title on success, or
 *   `{ error: { message } }` with an appropriate HTTP status on failure:
 *   - 400 Invalid category / unknown custom field id / missing required fields
 *   - 401/403 Auth or permission errors (surfaced by `requireMobileAuth` /
 *     `requireMobilePermission`)
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.create,
    });

    const body = await request.json();
    const {
      title,
      description,
      categoryId,
      locationId,
      valuation,
      customFields,
    } = z
      .object({
        title: z.string().min(2, "Title must be at least 2 characters"),
        description: z.string().optional(),
        categoryId: z.string().optional(),
        locationId: z.string().optional(),
        valuation: z.number().optional(),
        customFields: z
          .array(
            z.object({
              id: z.string(),
              value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
            })
          )
          .optional(),
      })
      .parse(body);

    // why: a categoryId from the request body is attacker-controlled. Without
    // verifying it belongs to the caller's organization we'd happily use it to
    // probe `getActiveCustomFields` for category metadata across tenants.
    if (categoryId) {
      const category = await db.category.findFirst({
        where: { id: categoryId, organizationId },
        select: { id: true },
      });
      if (!category) {
        return data(
          { error: { message: "Invalid category" } },
          { status: 400 }
        );
      }
    }

    // why: every category may have its own set of required custom fields.
    // We always fetch the active definitions for the chosen category (or
    // for "no category" if none provided) so we can enforce required-ness
    // and coerce the submitted values against the canonical type/shape
    // before persisting. Mirrors the webapp create form's mergedSchema +
    // extractCustomFieldValuesFromPayload pipeline so mobile and web share
    // the same data-integrity guarantees.
    const customFieldDef = await getActiveCustomFields({
      organizationId,
      category: categoryId ?? null,
    });

    // why: enforce required-field totality at CREATE time. The matching check
    // on update is intentionally narrower (only blocks explicit clears) — see
    // the docstring on the update route for rationale.
    const submittedById = new Map(
      (customFields ?? []).map((cf) => [cf.id, cf.value])
    );
    const missingRequired: string[] = [];
    for (const def of customFieldDef) {
      if (!def.required) continue;
      const submitted = submittedById.get(def.id);
      // why: treat whitespace-only strings as missing. Without `.trim()` a
      // caller could submit "   " and bypass the required check.
      if (
        submitted === undefined ||
        submitted === null ||
        submitted === "" ||
        (typeof submitted === "string" && submitted.trim() === "")
      ) {
        missingRequired.push(def.name);
      }
    }
    if (missingRequired.length > 0) {
      return data(
        {
          error: {
            message: `Missing required custom field${
              missingRequired.length === 1 ? "" : "s"
            }: ${missingRequired.join(", ")}`,
          },
        },
        { status: 400 }
      );
    }

    let customFieldsValues;
    if (customFields && customFields.length > 0) {
      // why: unknown-id rejection + BOOLEAN normalisation + cf-{id} reshape
      // live in a shared helper now (both create and update use it). Removes
      // ~40 lines of duplicated logic and the drift surface that came with
      // it. See `mobile-custom-fields.server.ts` for the why behind each
      // transformation step.
      const built = buildMobileCustomFieldPayload(customFields, customFieldDef);
      if (!built.ok) {
        return data(
          {
            error: {
              message: `Unknown custom field id: ${built.unknownId}`,
            },
          },
          { status: 400 }
        );
      }
      customFieldsValues = extractCustomFieldValuesFromPayload({
        payload: built.payload,
        customFieldDef,
      });
    }

    const asset = await createAsset({
      title,
      description: description || "",
      userId: user.id,
      organizationId,
      categoryId: categoryId || null,
      locationId: locationId || undefined,
      valuation: valuation ?? null,
      customFieldsValues,
    });

    return data({
      asset: {
        id: asset.id,
        title: asset.title,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
