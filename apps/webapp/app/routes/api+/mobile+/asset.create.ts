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
import { getLocationUpdateNoteContent } from "~/modules/asset/utils.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { createNote } from "~/modules/note/service.server";
import { buildTagsSet } from "~/modules/tag/service.server";
import { extractCustomFieldValuesFromPayload } from "~/utils/custom-fields";
import { makeShelfError, ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import { assertTagsAssignableToAssets } from "~/utils/org-validation.server";
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
 *   qrId?: string (optional - links an existing unlinked QR code to the asset)
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
      tags,
      valuation,
      customFields,
      qrId,
    } = z
      .object({
        title: z.string().min(2, "Title must be at least 2 characters"),
        description: z.string().optional(),
        categoryId: z.string().optional(),
        locationId: z.string().optional(),
        // Tag ids to assign to the new asset. Validated below against the
        // caller's organization before they are connected.
        tags: z.array(z.string()).optional(),
        valuation: z.number().optional(),
        customFields: z
          .array(
            z.object({
              id: z.string(),
              value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
            })
          )
          .optional(),
        qrId: z.string().optional(),
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

    // why: tag ids come from request input and are attacker-controlled. Assert
    // they belong to the caller's org AND are assignable to assets (useFor empty
    // or ASSET) before connecting them — matching the picker's source — so a
    // crafted request can't attach a booking-only tag. No-op when no tags are
    // supplied.
    await assertTagsAssignableToAssets({ tagIds: tags ?? [], organizationId });

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
      // Connect the (org-validated) tags. `buildTagsSet` takes a comma-joined
      // id string and is the same helper the web create form uses.
      tags: buildTagsSet(tags && tags.length ? tags.join(",") : undefined),
      valuation: valuation ?? null,
      customFieldsValues,
      qrId: qrId || undefined,
    });

    // why: the same two notes the web create route writes. `createAsset` emits
    // the ASSET_CREATED activity event on its own, so reports were already in
    // step, but the human-readable feed on the asset page was not: an asset
    // created from the phone opened with an empty history while the identical
    // asset created on the website said who made it and where they put it.
    //
    // `asset.user` is the full User row (createAsset's include is `user: true`),
    // so it is passed whole: `wrapUserLinkForNote` prefers `displayName` over
    // first+last, and hand-picking the two name fields renamed anyone who had
    // set one.
    const actor = wrapUserLinkForNote(asset.user);

    // Mirrors web: only the single primary placement is named, since a
    // quantity-tracked asset can hold several AssetLocation rows. The row (not
    // just its location) is what we need — `AssetLocation.quantity` is the
    // multiplier the note phrasing uses for a QUANTITY_TRACKED asset.
    const primaryPlacement = asset.assetLocations?.[0] ?? null;

    const noteContents = [`Asset was created by ${actor}.`];

    if (primaryPlacement?.location) {
      // The sentence, the link and the QT-aware "placed 50 units at X" variant
      // are all owned by this helper, which every later placement change also
      // goes through. Hand-rolling the string here is what made a QT asset read
      // "set the location to X" on create and "moved 50 units …" ever after.
      noteContents.push(
        getLocationUpdateNoteContent({
          newLocation: primaryPlacement.location,
          userId: asset.user.id,
          firstName: asset.user.firstName ?? "",
          lastName: asset.user.lastName ?? "",
          displayName: asset.user.displayName,
          type: asset.type,
          unitOfMeasure: asset.unitOfMeasure,
          quantity: primaryPlacement.quantity,
        })
      );
    }

    // why: the asset and its ASSET_CREATED event are already committed by the
    // time we get here, so a failed note must not be reported as a failed
    // creation. It made the companion create screen offer a retry for an asset
    // that already existed - and with a scanned `qrId` the retry took a fresh
    // QR while the first asset kept the scanned one, so the label in the user's
    // hand pointed at the wrong row. A missing note costs far less than that.
    // Same shape as the sibling mobile routes (asset.adjust-quantity.ts).
    //
    // Written one at a time rather than concurrently: the feed orders by
    // `createdAt` and two inserts issued in the same tick routinely land in the
    // same millisecond, which showed the placement above the creation. Failures
    // are swallowed per note, so a failed placement note cannot also cost us the
    // creation note.
    for (const content of noteContents) {
      try {
        await createNote({
          content,
          type: "UPDATE",
          userId: user.id,
          assetId: asset.id,
          organizationId,
        });
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message: "Failed to write the creation note for a new asset",
            label: "Assets",
            additionalData: { assetId: asset.id, userId: user.id },
          })
        );
      }
    }

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
