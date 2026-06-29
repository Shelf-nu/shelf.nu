import { useState } from "react";
import type { RenderableTreeNode } from "@markdoc/markdoc";
import {
  AssetStatus,
  CustomFieldType,
  OrganizationRoles,
} from "@prisma/client";
import type {
  MetaFunction,
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { CustodyCard } from "~/components/assets/asset-custody-card";
import { AssetReminderCards } from "~/components/assets/asset-reminder-cards";
import { MoveUnitsDialog } from "~/components/assets/move-units-dialog";
import { QuantityCustodyList } from "~/components/assets/quantity-custody-list";
import { QuantityOverviewCard } from "~/components/assets/quantity-overview-card";
import { BarcodeCard } from "~/components/barcode/barcode-card";
import { UnlockBarcodesBanner } from "~/components/barcode/unlock-barcodes-banner";
import { CodePreview } from "~/components/code-preview/code-preview";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import Input from "~/components/forms/input";
import { Switch } from "~/components/forms/switch";
import Icon from "~/components/icons/icon";
import ContextualModal from "~/components/layout/contextual-modal";
import type { HeaderData } from "~/components/layout/header/types";
import { LocationBadge } from "~/components/location/location-badge";
import { LocationSelect } from "~/components/location/location-select";
import { ScanDetails } from "~/components/location/scan-details";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { DateS } from "~/components/shared/date";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import { InlineEditableField } from "~/components/shared/inline-editable-field";
import { Tag } from "~/components/shared/tag";
import TextualDivider from "~/components/shared/textual-divider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { usePosition } from "~/hooks/use-position";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getAssetOverviewFields } from "~/modules/asset/fields";
import {
  MOVE_UNITS_INTENT_FIELD,
  type MoveAxis,
} from "~/modules/asset/move-units.types";
import {
  getActiveCustomFieldsForAsset,
  getAsset,
  getCategoriesForCreateAndEdit,
  getLocationsForCreateAndEdit,
  moveAssetLocationUnits,
  parseAssetValuation,
  placeUnplacedUnits,
  updateAsset,
  updateAssetBookingAvailability,
} from "~/modules/asset/service.server";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import {
  getPrimaryKit,
  getPrimaryLocation,
  isQuantityTracked,
} from "~/modules/asset/utils";
import { getRemindersForOverviewPage } from "~/modules/asset-reminder/service.server";
import { computeCheckedOutForAsset } from "~/modules/booking/service.server";
import { getPrimaryCustody } from "~/modules/custody/utils";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { moveAssetKitUnits } from "~/modules/kit/service.server";
import { generateQrObj } from "~/modules/qr/utils.server";
import { getScanByQrId } from "~/modules/scan/service.server";
import { parseScanData } from "~/modules/scan/utils.server";
import { getTeamMembersForQuantityCustody } from "~/modules/team-member/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getClientHint } from "~/utils/client-hints";
import { formatCurrency } from "~/utils/currency";
import { buildCustomFieldLinkHref } from "~/utils/custom-field-link";
import {
  buildCustomFieldValue,
  getCustomFieldDisplayValue,
} from "~/utils/custom-fields";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { error, getParams, payload, parseData } from "~/utils/http.server";
import { isLink } from "~/utils/misc";
import {
  userCanViewSpecificCustody,
  userHasCustodyViewPermission,
} from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { hasPermission } from "~/utils/permissions/permission.validator.server";
import { useBarcodePermissions } from "~/utils/permissions/use-barcode-permissions";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

type AssetWithOptionalBarcodes = ReturnType<
  typeof useLoaderData<typeof loader>
>["asset"] & {
  barcodes?: Array<{
    id: string;
    type: any;
    value: string;
  }>;
  _count?: {
    barcodes: number;
  };
};

export const AvailabilityForBookingFormSchema = z.object({
  availableToBook: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { assetId: id } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const {
      organizationId,
      userOrganizations,
      currentOrganization,
      canUseBarcodes,
      role,
    } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const { locale, timeZone } = getClientHint(request);

    const asset = await getAsset({
      id,
      organizationId,
      userOrganizations,
      request,
      include: getAssetOverviewFields(id, canUseBarcodes),
    });

    /**
     * We get the first QR code(for now we can only have 1)
     * And using the ID of tha qr code, we find the latest scan
     */
    const lastScan = asset.qrCodes[0]?.id
      ? parseScanData({
          scan: (await getScanByQrId({ qrId: asset.qrCodes[0].id })) || null,
          userId,
        })
      : null;

    const qrObj = await generateQrObj({
      assetId: asset.id,
      userId,
      organizationId,
    });

    /**
     * Derive edit permission once in the loader so we can conditionally
     * skip the heavy categories/locations/custom-field-defs queries for
     * users who are view-only. Uses the server-side `hasPermission` because
     * the client-side `userHasPermission` validator file has the `.client.`
     * suffix and is stripped from the SSR bundle. Passing `roles` explicitly
     * avoids the validator's DB fallback lookup.
     */
    const roles = userOrganizations.find(
      (o) => o.organization.id === organizationId
    )?.roles;

    const canEditAsset = await hasPermission({
      userId,
      organizationId,
      roles,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const reminders = await getRemindersForOverviewPage({
      assetId: id,
      organizationId,
    });
    /**
     * Compute quantity availability for QUANTITY_TRACKED assets.
     * Sums custody records AND booking reservations to determine how many
     * units are currently available. Booking reservations split into two
     * disjoint buckets so the sidebar surfaces both at a glance:
     *
     *   - `reserved` — units committed to bookings but NOT yet physically
     *     gone. Combines RESERVED-booking quantities (future bookings)
     *     with the ONGOING/OVERDUE "booked but not yet checked out"
     *     remainder. Subtracts from `available` (booking-aware) but not
     *     from `custodyAvailable` (physical-only).
     *   - `checkedOut` — units actively off the shelf via an ONGOING /
     *     OVERDUE booking, computed via the shared OUT-flow primitive.
     *     Subtracts from both `available` and `custodyAvailable`.
     */
    let quantityData: {
      total: number;
      /**
       * Operator-only custody — sum of `Custody.quantity` where
       * `kitCustodyId IS NULL`. Kit-allocated custody rows mirror
       * `AssetKit.quantity` and are already counted via `inKits`;
       * including them here would double-count.
       */
      inCustody: number;
      /**
       * Sum of `AssetKit.quantity` across every kit this asset
       * participates in. Surfaced on the sidebar so users can see how
       * many units are earmarked for kit use, and used in the
       * `available` / `custodyAvailable` formulas so kit-earmarked
       * units don't masquerade as free stock.
       */
      inKits: number;
      /**
       * Sum of `AssetLocation.quantity` across every location this
       * asset is placed at. Surfaced on the sidebar Quantity Overview
       * so users see the placed / unplaced split at a glance. Does NOT
       * subtract from `available` — placements are orthogonal to
       * custody / bookings (per the PRD design principle and the
       * orthogonal-MAX formula in `getLocationPickerMeta`).
       */
      inLocations: number;
      /**
       * Units committed to bookings but NOT yet physically off the shelf.
       * Covers RESERVED bookings (future) + the ONGOING/OVERDUE
       * booked-but-not-yet-checked-out remainder. Disjoint from
       * `checkedOut` — every booked unit appears in exactly one bucket.
       */
      reserved: number;
      /**
       * Units actively off the shelf via ONGOING/OVERDUE bookings,
       * computed via the shared OUT-flow primitive
       * (`computeCheckedOutForAsset`).
       */
      checkedOut: number;
      /**
       * Booking-aware availability: how many units can be reserved for a
       * *future* booking. Subtracts everything that's already spoken for —
       * kits + operator custody + reserved in other bookings + checked-out.
       */
      available: number;
      /**
       * Physical availability: how many units are *actually* on the shelf
       * right now — not in a kit, not held by a custodian, and not
       * currently checked out on an active booking. Used to cap custody
       * assignment and total-quantity adjustments. Reservations (future
       * bookings) do NOT subtract from this because the units are still
       * physically present until that booking is checked out.
       */
      custodyAvailable: number;
    } | null = null;

    if (isQuantityTracked(asset)) {
      // "Reserved (bookings)" on the overview card surfaces every unit
      // that is committed to a booking but NOT yet physically off the
      // shelf — so users instantly see the chunk that's neither truly
      // free nor already gone. That single bucket has two contributors:
      //
      //   1. RESERVED bookings — no progressive-checkout component, the
      //      naive `Σ BookingAsset.quantity` is the whole earmarked count.
      //   2. ONGOING / OVERDUE bookings — the booked total MINUS what's
      //      already been scanned out via PartialBookingCheckout. The
      //      OUT-side primitive (`computeCheckedOutForAsset`) gives us
      //      the truly-out count; subtracting it from the active-booking
      //      booked total yields the booked-but-not-yet-out remainder.
      //
      // "Checked out (bookings)" is computed via the shared helper so
      // the overview sidebar stays in lock-step with the OUT-flow's
      // per-slice math.
      const [reservedSum, ongoingBookedSum, checkedOut] = await Promise.all([
        db.bookingAsset.aggregate({
          where: {
            assetId: asset.id,
            booking: { status: "RESERVED", organizationId },
          },
          _sum: { quantity: true },
        }),
        // Active-booking booked total — sum of every `BookingAsset.quantity`
        // slice on an ONGOING/OVERDUE booking. The not-yet-out remainder
        // is this minus `checkedOut`.
        db.bookingAsset.aggregate({
          where: {
            assetId: asset.id,
            booking: {
              status: { in: ["ONGOING", "OVERDUE"] },
              organizationId,
            },
          },
          _sum: { quantity: true },
        }),
        // Org-scope: pass the caller's organizationId so the helper can
        // never accidentally surface checked-out counts from another
        // workspace if a cross-org asset id were ever supplied.
        computeCheckedOutForAsset(db, asset.id, organizationId),
      ]);

      const total = asset.quantity ?? 0;
      // Floor at 0 defensively — pathological data (PartialBookingCheckout
      // claims exceeding the booked total) could otherwise produce a
      // negative remainder.
      const ongoingBookedNotYetOut = Math.max(
        0,
        (ongoingBookedSum._sum?.quantity ?? 0) - checkedOut
      );
      // Combine RESERVED bookings + the ONGOING-not-yet-out remainder
      // so the "Reserved (bookings)" row reflects every unit committed
      // to a booking but still physically present.
      const reserved =
        (reservedSum._sum?.quantity ?? 0) + ongoingBookedNotYetOut;
      // Sum each kit's slice — the asset's pool earmarked for kit use.
      const inKits = (asset.assetKits ?? []).reduce(
        (sum: number, ak) => sum + (ak.quantity ?? 0),
        0
      );
      // Sum each location's slice — the asset's pool that has a
      // physical placement. The remainder (`total − inLocations`) is
      // the "unplaced" pool: units the org owns but haven't been put
      // anywhere yet (in transit, just received, etc.).
      const inLocations = (asset.assetLocations ?? []).reduce(
        (sum: number, al) => sum + (al.quantity ?? 0),
        0
      );
      // Operator-only custody (see field comment above).
      const operatorCustody = (asset.custody ?? []).reduce(
        (sum: number, c) =>
          c.kitCustodyId == null ? sum + (c.quantity ?? 0) : sum,
        0
      );

      quantityData = {
        total,
        inCustody: operatorCustody,
        inKits,
        inLocations,
        reserved,
        checkedOut,
        // Strict-available pool: kits + operator + reserved + checked-out
        // are all separate consumers; what's left is truly free.
        available: total - inKits - operatorCustody - reserved - checkedOut,
        // Adjust-cap: reservations don't subtract here (units are still
        // physically present), but kits do because dropping below
        // `inKits` would violate the sum-within-total DB trigger.
        custodyAvailable: total - inKits - operatorCustody - checkedOut,
      };
    }

    /**
     * For QUANTITY_TRACKED assets, fetch team members for the custody
     * dialog. Self-service users are scoped to only their own record.
     */
    const { teamMembers, totalTeamMembers } = isQuantityTracked(asset)
      ? await getTeamMembersForQuantityCustody({
          organizationId,
          request,
          userId,
          isSelfService: role === OrganizationRoles.SELF_SERVICE,
        })
      : { teamMembers: [], totalTeamMembers: 0 };

    const bookingAsset =
      asset.bookingAssets.length > 0 ? asset.bookingAssets[0] : undefined;
    const currentBooking: any = null;

    if (bookingAsset && bookingAsset.booking.from) {
      asset.bookingAssets = [currentBooking];
    }
    /** We only need customField with same category of asset or without any category */
    const customFields = asset.categoryId
      ? asset.customFields.filter(
          (cf) =>
            !cf.customField.categories.length ||
            cf.customField.categories
              .map((c) => c.id)
              .includes(asset.categoryId!)
        )
      : asset.customFields;

    /**
     * Editor data is only needed for users who can update the asset. View-only
     * users see static display rows and never enter edit mode, so we skip the
     * categories/locations/custom-fields-definitions queries entirely. We also
     * skip tags — they are read-only on the overview page in this iteration.
     */
    const [allCustomFieldDefs, categoriesData, locationsData] = canEditAsset
      ? await Promise.all([
          getActiveCustomFields({
            organizationId,
            category: asset.categoryId,
          }),
          getCategoriesForCreateAndEdit({
            request,
            organizationId,
            defaultCategory: asset.categoryId,
          }),
          getLocationsForCreateAndEdit({
            request,
            organizationId,
            defaultLocation: getPrimaryLocation(asset)?.id ?? undefined,
          }),
        ])
      : [
          [],
          { categories: [], totalCategories: 0 },
          { locations: [], totalLocations: 0 },
        ];

    const { categories, totalCategories } = categoriesData;
    const { locations, totalLocations } = locationsData;
    const header: HeaderData = {
      title: `${asset.title}'s overview`,
    };

    /**
     * Move-units destinations: org-wide list of `{ id, name }` shapes for the
     * `MoveUnitsDialog` destination picker (split/merge UX).
     *
     * Returned unfiltered — render-time logic filters out the current source
     * row per dialog instance so the picker never offers the source as a
     * destination. Tight `select` keeps payload small even on orgs with
     * thousands of locations or kits.
     *
     * Only meaningful for QUANTITY_TRACKED assets; the dialogs themselves
     * are gated by `isQuantityTracked(asset)` in the JSX below.
     */
    const [allOrgLocations, allOrgKits] = isQuantityTracked(asset)
      ? await Promise.all([
          db.location.findMany({
            where: { organizationId },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          }),
          db.kit.findMany({
            where: { organizationId },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          }),
        ])
      : [[], []];

    const moveDestinations = {
      locations: allOrgLocations,
      kits: allOrgKits,
    };

    /**
     * Unplaced quantity = `Asset.quantity` − Σ `AssetLocation.quantity` for
     * MANUAL pivot rows (`assetKitId IS NULL`). Kit-driven AssetLocation
     * rows are derived from `AssetKit.quantity` and would double-count.
     * Always `0` for INDIVIDUAL assets.
     */
    const unplacedQuantity = isQuantityTracked(asset)
      ? Math.max(
          0,
          (asset.quantity ?? 0) -
            (asset.assetLocations ?? []).reduce(
              (sum: number, al) =>
                al.assetKitId == null ? sum + (al.quantity ?? 0) : sum,
              0
            )
        )
      : 0;

    return payload({
      asset: {
        ...asset,
        customFields,
      },
      currentOrganization,
      userId,
      lastScan,
      header,
      locale,
      timeZone,
      qrObj,
      reminders,
      quantityData,
      teamMembers,
      totalTeamMembers,
      categories,
      totalCategories,
      locations,
      totalLocations,
      allCustomFieldDefs,
      moveDestinations,
      unplacedQuantity,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Overview",
};

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId: id } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const formData = await request.formData();

    /**
     * Move-units intents (`MoveAxis`) are dispatched off a separate hidden
     * field — `MOVE_UNITS_INTENT_FIELD` — so we can keep the existing
     * `intent` enum dispatch below untouched. The `MoveUnitsDialog` component
     * always sends this field; if present, take that branch and return.
     */
    const moveUnitsIntentRaw = formData.get(MOVE_UNITS_INTENT_FIELD);
    if (typeof moveUnitsIntentRaw === "string" && moveUnitsIntentRaw) {
      const moveResult = await handleMoveUnitsIntent({
        formData,
        assetId: id,
        organizationId,
        userId,
      });
      return moveResult;
    }

    const { intent } = parseData(
      formData,
      z.object({ intent: z.enum(["toggle", "updateField"]) })
    );

    if (intent === "toggle") {
      const { availableToBook } = parseData(
        formData,
        AvailabilityForBookingFormSchema
      );

      await updateAssetBookingAvailability({
        id,
        organizationId,
        availableToBook,
      });

      sendNotification({
        title: "Asset availability status updated successfully",
        message: "Your asset's availability for booking has been updated",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
      return payload(null);
    } else if (intent === "updateField") {
      const { fieldName } = parseData(
        formData,
        z.object({
          fieldName: z.enum([
            "description",
            "category",
            "location",
            "valuation",
            "customField",
          ]),
        })
      );

      const fieldValue = formData.get("fieldValue") as string | null;

      switch (fieldName) {
        case "description": {
          /** Trim whitespace; treat empty as empty string (Prisma allows it) */
          const description = (fieldValue ?? "").trim();
          await updateAsset({
            id,
            description,
            userId,
            organizationId,
            request,
          });
          break;
        }
        case "category": {
          await updateAsset({
            id,
            categoryId: fieldValue || "uncategorized",
            userId,
            organizationId,
            request,
          });
          break;
        }
        case "location": {
          const newLocationId =
            (formData.get("newLocationId") as string) || undefined;
          const currentLocationId =
            (formData.get("currentLocationId") as string) || undefined;
          await updateAsset({
            id,
            newLocationId,
            currentLocationId,
            userId,
            organizationId,
            request,
          });
          break;
        }
        case "valuation": {
          const rawVal = formData.get("fieldValue") as string | null;
          const valuation = parseAssetValuation(rawVal);
          await updateAsset({
            id,
            valuation,
            userId,
            organizationId,
            request,
          });
          break;
        }
        case "customField": {
          const customFieldId = formData.get("customFieldId") as string;

          /**
           * Org+category scoped lookup. Throws 404 if the asset does not belong
           * to this organization, blocking cross-org writes. The asset's category
           * is what gates which custom-field defs are returned, preventing crafted
           * POSTs from writing values for fields outside this asset's category.
           */
          const customFields = await getActiveCustomFieldsForAsset({
            id,
            organizationId,
          });
          const fieldDef = customFields.find((cf) => cf.id === customFieldId);
          if (!fieldDef) {
            throw new ShelfError({
              cause: null,
              message: "Custom field not found",
              label: "Assets",
              status: 400,
            });
          }

          const builtValue = buildCustomFieldValue(
            { raw: fieldValue ?? "" },
            fieldDef
          );

          /**
           * Block clearing required custom fields. The full edit form
           * enforces this via mergedSchema; inline editing must match.
           */
          if (!builtValue && fieldDef.required) {
            throw new ShelfError({
              cause: null,
              message: `${fieldDef.name} is required and cannot be empty`,
              label: "Assets",
              shouldBeCaptured: false,
              status: 400,
            });
          }

          const customFieldsValues = builtValue
            ? [{ id: customFieldId, value: builtValue }]
            : [{ id: customFieldId, value: undefined }];

          await updateAsset({
            id,
            customFieldsValues:
              customFieldsValues as ShelfAssetCustomFieldValueType[],
            userId,
            organizationId,
            request,
          });
          break;
        }
        default:
          checkExhaustiveSwitch(fieldName);
      }

      sendNotification({
        title: "Asset updated",
        message: "Your asset has been updated successfully",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
      return payload({ success: true });
    } else {
      checkExhaustiveSwitch(intent);
      return payload(null);
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return data(error(reason), { status: reason.status });
  }
}

/**
 * Zod schemas for the three move-units intents. Each schema carries the
 * discriminator literal so we can narrow off it after parse.
 *
 * - `location`       — manual AssetLocation → AssetLocation move
 * - `kit`            — AssetKit → AssetKit move (cascades to bookings)
 * - `place-unplaced` — one-sided placement of unplaced units
 *
 * `toId` is the destination row id submitted by the dialog's hidden mirror
 * (axis-agnostic). The server maps it to `toLocationId` / `toKitId` per axis.
 */
const moveUnitsLocationSchema = z.object({
  [MOVE_UNITS_INTENT_FIELD]: z.literal("location"),
  fromLocationId: z.string().cuid("Invalid source location."),
  toId: z.string().cuid("Please pick a destination."),
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number.")
    .positive("Quantity must be greater than zero."),
});

const moveUnitsKitSchema = z.object({
  [MOVE_UNITS_INTENT_FIELD]: z.literal("kit"),
  fromKitId: z.string().cuid("Invalid source kit."),
  toId: z.string().cuid("Please pick a destination."),
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number.")
    .positive("Quantity must be greater than zero."),
});

const placeUnplacedSchema = z.object({
  [MOVE_UNITS_INTENT_FIELD]: z.literal("place-unplaced"),
  toId: z.string().cuid("Please pick a destination."),
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number.")
    .positive("Quantity must be greater than zero."),
});

/**
 * Handle a `MoveUnitsDialog` submission. Dispatches on the axis discriminator,
 * validates the form body with axis-specific Zod schema, and calls the matching
 * Wave 1 service. Errors are wrapped with `error()` so `getValidationErrors`
 * on the client can surface per-field messages.
 *
 * @param args.formData      - Parsed request form data
 * @param args.assetId       - Asset id from the route params
 * @param args.organizationId - Caller's active organization
 * @param args.userId        - Acting user id (for note + event authorship)
 * @returns A `data()` response wrapping `{ success: true }` or an error.
 */
async function handleMoveUnitsIntent({
  formData,
  assetId,
  organizationId,
  userId,
}: {
  formData: FormData;
  assetId: string;
  organizationId: string;
  userId: string;
}) {
  /**
   * Narrow off the axis discriminator with a small enum parse first so we
   * give a clear error for malformed inputs before running the axis-specific
   * schema.
   */
  const moveAxisEnum: z.ZodType<MoveAxis> = z.enum([
    "location",
    "kit",
    "place-unplaced",
  ]);
  const { [MOVE_UNITS_INTENT_FIELD]: axis } = parseData(
    formData,
    z.object({
      [MOVE_UNITS_INTENT_FIELD]: moveAxisEnum,
    })
  );

  try {
    switch (axis) {
      case "location": {
        const parsed = parseData(formData, moveUnitsLocationSchema);
        await moveAssetLocationUnits({
          assetId,
          organizationId,
          userId,
          fromLocationId: parsed.fromLocationId,
          toLocationId: parsed.toId,
          quantity: parsed.quantity,
        });
        return payload({ success: true });
      }
      case "kit": {
        const parsed = parseData(formData, moveUnitsKitSchema);
        await moveAssetKitUnits({
          assetId,
          organizationId,
          userId,
          fromKitId: parsed.fromKitId,
          toKitId: parsed.toId,
          quantity: parsed.quantity,
        });
        return payload({ success: true });
      }
      case "place-unplaced": {
        const parsed = parseData(formData, placeUnplacedSchema);
        await placeUnplacedUnits({
          assetId,
          organizationId,
          userId,
          toLocationId: parsed.toId,
          quantity: parsed.quantity,
        });
        return payload({ success: true });
      }
      default:
        checkExhaustiveSwitch(axis);
        return payload(null);
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId, axis });
    return data(error(reason), { status: reason.status });
  }
}

// react-doctor:no-giant-component — deferred for follow-up refactor
export default function AssetOverview() {
  const {
    asset,
    locale,
    timeZone,
    qrObj,
    lastScan,
    currentOrganization,
    userId,
    quantityData,
    allCustomFieldDefs,
    moveDestinations,
    unplacedQuantity,
  } = useLoaderData<typeof loader>();

  /** Route URL used by all three `MoveUnitsDialog` form submissions. */
  const moveUnitsActionUrl = `/assets/${asset.id}/overview`;

  const booking =
    asset.status === AssetStatus.CHECKED_OUT && asset?.bookingAssets?.length
      ? asset?.bookingAssets[0]?.booking
      : undefined;

  /**
   * Build ONE unified list of ALL custom fields, sorted alphabetically.
   * Each entry pairs the field definition with its stored value (or null
   * if not set). This keeps fields in a stable position regardless of
   * whether they have values — no jumping when a user adds or clears data.
   */
  const customFieldsValueMap = new Map(
    (asset?.customFields ?? [])
      .filter((f) => f.value)
      .map((f) => [f.customField.id, f])
  );
  const allCustomFields = (allCustomFieldDefs ?? [])
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((def) => ({
      def,
      storedValue: customFieldsValueMap.get(def.id) ?? null,
    }));

  const location = asset ? getPrimaryLocation(asset) : null;
  usePosition();
  const fetcher = useFetcher();
  const zo = useZorm(
    "NewQuestionWizardScreen",
    AvailabilityForBookingFormSchema
  );
  const { roles, isSelfService } = useUserRoleHelper();
  const { canUseBarcodes } = useBarcodePermissions();
  const canUpdateAvailability = userHasPermission({
    roles,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
  });
  const canCustody = userHasPermission({
    roles,
    entity: PermissionEntity.asset,
    action: PermissionAction.custody,
  });
  const canViewAllCustody = userHasCustodyViewPermission({
    roles,
    organization: currentOrganization,
  });
  const canEditAsset = canUpdateAvailability;

  return (
    <div>
      <ContextualModal />
      <div className="mx-[-16px] mt-[-16px] block md:mx-0 lg:flex ">
        <div className="max-w-full flex-1 overflow-hidden">
          <Card className="my-3 max-w-full px-[-4] py-[-5] md:border">
            <ul className="item-information">
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-1/4 text-[14px] font-medium text-gray-900">
                  ID
                </span>
                <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
                  {asset?.id}
                </div>
              </li>
              {asset?.sequentialId ? (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Asset ID
                  </span>
                  <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
                    {asset.sequentialId}
                  </div>
                </li>
              ) : null}
              {asset?.qrCodes?.[0] ? (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Shelf QR ID
                  </span>
                  <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
                    {asset.qrCodes[0].id}
                  </div>
                </li>
              ) : null}
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-1/4 text-[14px] font-medium text-gray-900">
                  Created
                </span>
                <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
                  <DateS date={asset.createdAt} includeTime />
                </div>
              </li>

              <InlineEditableField
                fieldName="category"
                label="Category"
                canEdit={canEditAsset}
                renderDisplay={() => (
                  <Badge
                    color={asset.category?.color ?? "#808080"}
                    withDot={false}
                  >
                    {asset.category?.name ?? "Uncategorized"}
                  </Badge>
                )}
                renderEditor={() => (
                  <DynamicSelect
                    fieldName="fieldValue"
                    defaultValue={asset.category?.id ?? undefined}
                    model={{ name: "category", queryKey: "name" }}
                    contentLabel="Categories"
                    placeholder="Select category"
                    initialDataKey="categories"
                    countKey="totalCategories"
                    closeOnSelect
                    allowClear
                    hideLabel
                  />
                )}
              />

              {isQuantityTracked(asset) ? (
                /*
                 * QUANTITY_TRACKED variant: render every placement with
                 * its per-location qty, and route the pencil edit
                 * button to the multi-row "Manage placements" modal
                 * instead of the inline single-location editor. Same
                 * shell as `InlineEditableField` so the row visually
                 * matches the rest of the detail list. INDIVIDUAL
                 * assets keep the original inline editor below (one
                 * pivot row max, the inline `LocationSelect` is fine).
                 */
                <li className="group/field w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Location
                  </span>
                  <div className="relative mt-1 flex items-start gap-2 md:mt-0 md:w-3/5">
                    <div className="min-w-0 flex-1">
                      {asset.assetLocations.length > 0 ? (
                        <ul className="-ml-2 flex flex-col gap-1">
                          {asset.assetLocations.map((al) => {
                            const viaKit = al.assetKit?.kit ?? null;
                            return (
                              <li
                                key={`${al.location.id}-${
                                  al.assetKitId ?? "manual"
                                }`}
                                className="flex items-center gap-2"
                              >
                                <LocationBadge
                                  location={{
                                    id: al.location.id,
                                    name: al.location.name,
                                    parentId: al.location.parentId,
                                    childCount:
                                      al.location._count?.children ?? 0,
                                  }}
                                />
                                {viaKit ? (
                                  <TooltipProvider delayDuration={150}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          to={`/kits/${viaKit.id}`}
                                          role="link"
                                          variant="link"
                                          target="_blank"
                                          className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 no-underline hover:bg-blue-100 hover:text-blue-800"
                                        >
                                          via kit
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        side="top"
                                        className="max-w-xs"
                                      >
                                        <p className="text-xs font-semibold text-gray-700">
                                          {viaKit.name}
                                        </p>
                                        <p className="mt-1 text-xs text-gray-500">
                                          These units are at this location
                                          because the asset is in this kit.
                                          Change the kit&apos;s location to move
                                          them.
                                        </p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ) : null}
                                <span className="shrink-0 text-xs tabular-nums text-gray-500">
                                  {al.quantity} {asset.unitOfMeasure || "units"}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <span className="text-gray-600">
                          No locations · {asset.quantity ?? 0}{" "}
                          {asset.unitOfMeasure || "units"} unplaced
                        </span>
                      )}
                    </div>
                    {canEditAsset ? (
                      <Button
                        // Relative to the current overview route
                        // (`/assets/<id>/overview/`) — the dropdown
                        // version uses `overview/manage-placements`
                        // because it's mounted from the parent route.
                        to="manage-placements"
                        variant="link"
                        aria-label="Manage placements"
                        title="Manage placements"
                        className="hidden shrink-0 rounded p-1 text-gray-500 transition-opacity hover:bg-gray-100 hover:text-gray-700 md:inline-flex md:opacity-0 md:group-hover/field:opacity-100 md:focus-visible:opacity-100"
                      >
                        <Icon icon="pen" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              ) : (
                <InlineEditableField
                  fieldName="location"
                  label="Location"
                  canEdit={canEditAsset}
                  isEmpty={!location}
                  renderDisplay={() =>
                    location ? (
                      <div className="-ml-2">
                        <LocationBadge
                          location={{
                            id: location.id,
                            name: location.name,
                            parentId: location.parentId,
                            childCount: location._count?.children ?? 0,
                          }}
                        />
                      </div>
                    ) : (
                      <span className="text-gray-600">No location</span>
                    )
                  }
                  renderEditor={() => (
                    <LocationSelect
                      isBulk={false}
                      locationId={location?.id ?? undefined}
                      fieldName="newLocationId"
                      defaultValue={location?.id ?? undefined}
                      hideClearButton={false}
                      hideCurrentLocationInput={false}
                    />
                  )}
                />
              )}

              <InlineEditableField
                fieldName="description"
                label="Description"
                canEdit={canEditAsset}
                isEmpty={!asset.description}
                renderDisplay={() => (
                  <div className="whitespace-pre-wrap text-gray-600">
                    {asset.description || "No description"}
                  </div>
                )}
                renderEditor={() => (
                  <div>
                    <Input
                      label="Description"
                      hideLabel
                      inputType="textarea"
                      name="fieldValue"
                      defaultValue={asset.description ?? ""}
                      className="w-full"
                      maxLength={1000}
                    />
                    <p className="mt-1 text-xs text-gray-400">
                      Maximum 1000 characters
                    </p>
                  </div>
                )}
              />

              {/* Tags — read-only display. Inline editing deferred to a
                  follow-up PR (TagsAutocomplete needs a multi-select
                  DynamicSelect variant for compact inline contexts). */}
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-1/4 text-[14px] font-medium text-gray-900">
                  Tags
                </span>
                <div className="mt-1 text-gray-600 md:mt-0 md:w-3/5">
                  {asset.tags?.length > 0 ? (
                    <div className="-ml-2">
                      {asset.tags.map((tag) => (
                        <Tag
                          key={tag.id}
                          className="ml-2"
                          color={tag.color ?? undefined}
                          withDot={false}
                        >
                          {tag.name}
                        </Tag>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-600">No tags</span>
                  )}
                </div>
              </li>

              <InlineEditableField
                fieldName="valuation"
                label="Value"
                canEdit={canEditAsset}
                isEmpty={asset.valuation == null}
                renderDisplay={() => (
                  <div className="text-gray-600">
                    {asset.valuation != null
                      ? formatCurrency({
                          value: asset.valuation,
                          locale,
                          currency: asset.organization.currency,
                        })
                      : "No value"}
                  </div>
                )}
                renderEditor={() => (
                  /*
                   * Use type="text" with inputMode="decimal" — NOT
                   * type="number" (which silently strips non-numeric chars
                   * before submit, making server-side validation unreachable)
                   * and NOT with a `pattern` attribute (which the browser
                   * enforces with a native validation tooltip that ALSO
                   * blocks form submission).
                   *
                   * The server-side `Number.isFinite()` check in the action
                   * handler is the source of truth for valuation validation;
                   * any browser-side gate would prevent the user from seeing
                   * those server errors.
                   *
                   * inputMode="decimal" still hints mobile keyboards to show
                   * the numeric keypad.
                   */
                  <Input
                    label="Value"
                    hideLabel
                    type="text"
                    inputMode="decimal"
                    name="fieldValue"
                    defaultValue={asset.valuation ?? undefined}
                    className="w-full"
                  />
                )}
              />

              {asset?.assetModel ? (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Asset Model
                  </span>
                  <div className="mt-1 text-gray-600 md:mt-0 md:w-3/5">
                    {userHasPermission({
                      roles,
                      entity: PermissionEntity.assetModel,
                      action: PermissionAction.update,
                    }) ? (
                      <Button
                        to={`/settings/asset-models/${asset.assetModel.id}/edit`}
                        variant="link-gray"
                        className="text-gray-600 underline"
                      >
                        {asset.assetModel.name}
                      </Button>
                    ) : (
                      <span>{asset.assetModel.name}</span>
                    )}
                  </div>
                </li>
              ) : null}
              {(() => {
                const assetWithBarcodes = asset as AssetWithOptionalBarcodes;
                const barcodeCount =
                  assetWithBarcodes.barcodes?.length ||
                  assetWithBarcodes._count?.barcodes ||
                  0;

                if (!barcodeCount) return null;

                // Barcodes exist and addon is enabled — show them
                if (canUseBarcodes && assetWithBarcodes.barcodes?.length) {
                  return (
                    <li className="w-full max-w-full p-4 last:border-b-0 md:block">
                      <span className="mb-3 flex items-center gap-1 text-[14px] font-medium text-gray-900">
                        Barcodes ({assetWithBarcodes.barcodes.length})
                        <InfoTooltip
                          iconClassName="size-4"
                          content={
                            <>
                              <h6>Barcodes support</h6>
                              <p>
                                Want to know more about barcodes? Check out our
                                knowledge base article on{" "}
                                <Button
                                  variant="link"
                                  target="_blank"
                                  to="https://www.shelf.nu/knowledge-base/alternative-barcodes"
                                >
                                  barcode support
                                </Button>
                              </p>
                            </>
                          }
                        />
                      </span>
                      <div className="flex flex-wrap gap-3">
                        {assetWithBarcodes.barcodes.map((barcode) => (
                          <BarcodeCard key={barcode.id} barcode={barcode} />
                        ))}
                      </div>
                    </li>
                  );
                }

                // Barcodes exist but addon is disabled — show locked state
                return (
                  <li className="w-full max-w-full p-4 last:border-b-0 md:block">
                    <span className="mb-3 flex items-center gap-1 text-[14px] font-medium text-gray-900">
                      Barcodes ({barcodeCount})
                    </span>
                    <div className="flex flex-wrap gap-3">
                      {Array.from({ length: barcodeCount }).map((_, i) => (
                        <div
                          key={i}
                          className="flex h-[72px] w-[180px] items-center justify-center rounded border border-gray-200 bg-gray-50"
                        >
                          <div className="flex flex-col items-center gap-1 text-gray-400">
                            <Icon icon="lock" />
                            <span className="text-xs">Hidden</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3">
                      <UnlockBarcodesBanner />
                    </div>
                  </li>
                );
              })()}
            </ul>
          </Card>

          {/* Custom fields — one unified alphabetically-sorted list */}
          {allCustomFields.some((cf) => cf.storedValue) ||
          (canEditAsset && allCustomFields.length > 0) ? (
            <>
              <TextualDivider
                text="Custom fields"
                className="mb-8 pt-3 lg:hidden"
              />
              <Card className="my-3 px-[-4] py-[-5] md:border">
                <ul className="item-information">
                  {allCustomFields.map(({ def, storedValue }) => {
                    const hasValue = !!storedValue;
                    const fieldValue = hasValue
                      ? (storedValue.value as unknown as ShelfAssetCustomFieldValueType["value"])
                      : null;
                    const rawValue =
                      fieldValue?.raw !== undefined
                        ? String(fieldValue.raw)
                        : "";
                    const customFieldDisplayValue = hasValue
                      ? getCustomFieldDisplayValue(fieldValue!, {
                          locale,
                          timeZone,
                        })
                      : null;

                    /* Hide "Not set" rows from view-only users */
                    if (!hasValue && !canEditAsset) return null;

                    return (
                      <InlineEditableField
                        key={def.id}
                        fieldName={`customField-${def.id}`}
                        formFieldName="customField"
                        label={def.name}
                        canEdit={canEditAsset}
                        extraHiddenInputs={{
                          customFieldId: def.id,
                        }}
                        renderDisplay={() =>
                          hasValue ? (
                            <div
                              className={tw(
                                "text-gray-600",
                                def.type !== CustomFieldType.MULTILINE_TEXT &&
                                  "max-w-[350px]"
                              )}
                            >
                              {def.type === CustomFieldType.MULTILINE_TEXT ? (
                                <MarkdownViewer
                                  content={
                                    customFieldDisplayValue as RenderableTreeNode
                                  }
                                />
                              ) : isLink(customFieldDisplayValue as string) ? (
                                <Button
                                  variant="link-gray"
                                  target="_blank"
                                  to={buildCustomFieldLinkHref(
                                    customFieldDisplayValue as string
                                  )}
                                >
                                  {customFieldDisplayValue as string}
                                </Button>
                              ) : def.type === CustomFieldType.AMOUNT ? (
                                formatCurrency({
                                  value: fieldValue!.raw as number,
                                  locale,
                                  currency: asset.organization.currency,
                                })
                              ) : (
                                (customFieldDisplayValue as string)
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400">Not set</span>
                          )
                        }
                        renderEditor={() => {
                          switch (def.type) {
                            case CustomFieldType.MULTILINE_TEXT:
                              return (
                                <Input
                                  label={def.name}
                                  hideLabel
                                  inputType="textarea"
                                  name="fieldValue"
                                  defaultValue={rawValue}
                                  className="w-full"
                                />
                              );
                            case CustomFieldType.BOOLEAN:
                              return (
                                <BooleanCustomFieldEditor
                                  name="fieldValue"
                                  label={def.name}
                                  initialChecked={
                                    fieldValue?.raw === "yes" ||
                                    fieldValue?.raw === true
                                  }
                                  initialIsUnset={!hasValue}
                                />
                              );
                            case CustomFieldType.DATE:
                              return (
                                <Input
                                  label={def.name}
                                  hideLabel
                                  type="date"
                                  name="fieldValue"
                                  defaultValue={rawValue}
                                  className="w-full"
                                />
                              );
                            case CustomFieldType.OPTION:
                              return (
                                <select
                                  aria-label={def.name}
                                  name="fieldValue"
                                  defaultValue={rawValue}
                                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                                >
                                  <option value="">Select an option</option>
                                  {(def.options as string[] | null)
                                    ?.filter(
                                      (o: string) => o !== null && o !== ""
                                    )
                                    .map((option: string) => (
                                      <option key={option} value={option}>
                                        {option}
                                      </option>
                                    ))}
                                </select>
                              );
                            case CustomFieldType.AMOUNT:
                            case CustomFieldType.NUMBER:
                              return (
                                <Input
                                  label={def.name}
                                  hideLabel
                                  type="text"
                                  inputMode="decimal"
                                  name="fieldValue"
                                  defaultValue={rawValue}
                                  className="w-full"
                                />
                              );
                            default:
                              return (
                                <Input
                                  label={def.name}
                                  hideLabel
                                  name="fieldValue"
                                  defaultValue={rawValue}
                                  className="w-full"
                                />
                              );
                          }
                        }}
                      />
                    );
                  })}
                </ul>
              </Card>
            </>
          ) : null}
        </div>

        <div className="w-full md:w-[360px] lg:ml-4">
          <When truthy={canUpdateAvailability}>
            <Card className="my-3">
              <fetcher.Form
                ref={zo.ref}
                method="post"
                onChange={(e) => fetcher.submit(e.currentTarget)}
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="text-[14px] font-medium text-gray-700">
                      Available for bookings
                    </p>
                    <p className="text-[12px] text-gray-600">
                      Asset is available for being used in bookings
                    </p>
                  </div>
                  <Switch
                    name={zo.fields.availableToBook()}
                    disabled={
                      !canUpdateAvailability || isFormProcessing(fetcher.state)
                    } // Disable for self service users
                    defaultChecked={asset?.availableToBook}
                    required
                    title={
                      !canUpdateAvailability
                        ? "You do not have the permissions to change availability"
                        : "Toggle availability"
                    }
                  />
                  <input type="hidden" value="toggle" name="intent" />
                </div>
              </fetcher.Form>
            </Card>
          </When>

          <AssetReminderCards className="my-2" />

          {(() => {
            /**
             * A QUANTITY_TRACKED asset can belong to multiple kits at
             * distinct slices. Render one row per membership with the
             * per-kit quantity badge on qty-tracked assets; INDIVIDUAL
             * assets keep the single-name layout since they're DB-locked
             * to one kit and have no meaningful "quantity per kit" to
             * surface.
             */
            type KitMembership = {
              quantity: number;
              kit: { id: string; name: string } | null;
            };
            const memberships = ((asset.assetKits ?? []) as KitMembership[])
              .filter((ak) => ak.kit?.id && ak.kit.name)
              .map((ak) => ({
                kitId: ak.kit!.id,
                kitName: ak.kit!.name,
                quantity: ak.quantity ?? 0,
              }));
            if (memberships.length === 0) return null;
            const isQty = isQuantityTracked(asset);
            const unit = asset.unitOfMeasure || "units";
            return (
              <Card className="my-3 py-3 md:border">
                <div className="flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gray-100/50">
                    <div className="flex size-7 items-center justify-center rounded-full bg-gray-200">
                      <Icon icon="kit" />
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="mb-1 text-sm font-semibold">
                      {memberships.length > 1
                        ? "Included in kits"
                        : "Included in kit"}
                    </h3>
                    <ul className="space-y-1">
                      {memberships.map((m) => (
                        <li
                          key={m.kitId}
                          className="flex items-center justify-between gap-2"
                        >
                          <Button
                            to={`/kits/${m.kitId}`}
                            role="link"
                            variant="link"
                            className="min-w-0 justify-start truncate text-sm font-normal text-gray-700 underline hover:text-gray-700"
                            target="_blank"
                          >
                            <span className="truncate">{m.kitName}</span>
                          </Button>
                          <div className="flex shrink-0 items-center gap-2">
                            {isQty ? (
                              <span className="text-xs tabular-nums text-gray-500">
                                {m.quantity} {unit}
                              </span>
                            ) : null}
                            {/*
                             * Move-units affordance for kit allocations.
                             * QUANTITY_TRACKED-only — INDIVIDUAL assets are
                             * DB-locked to a single kit so the "move between
                             * kits" flow is not meaningful for them.
                             */}
                            {isQty && canEditAsset ? (
                              <MoveUnitsDialog
                                axis="kit"
                                assetId={asset.id}
                                assetTitle={asset.title}
                                unitOfMeasure={asset.unitOfMeasure}
                                fromKit={{
                                  id: m.kitId,
                                  name: m.kitName,
                                  quantity: m.quantity,
                                }}
                                destinations={moveDestinations.kits.filter(
                                  (k) => k.id !== m.kitId
                                )}
                                actionUrl={moveUnitsActionUrl}
                                trigger={
                                  <Button
                                    type="button"
                                    variant="link"
                                    className="text-xs font-normal text-gray-500 underline hover:text-gray-700"
                                  >
                                    Move
                                  </Button>
                                }
                              />
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Card>
            );
          })()}

          {(() => {
            /**
             * "Placed at locations" sidebar card — mirrors the
             * "Included in kits" card above. A QUANTITY_TRACKED asset
             * can sit at multiple locations at distinct per-location
             * slices; an INDIVIDUAL asset sits at exactly one. Render
             * one row per placement with the per-location quantity
             * badge for qty-tracked rows; the per-location qty is
             * irrelevant for INDIVIDUAL (always 1, no signal). Hide
             * the card entirely when there are zero placements so the
             * sidebar doesn't grow an empty section for unplaced
             * assets. The detailed multi-placement editor opens from
             * the "Edit placements" button on this card.
             */
            type Placement = {
              quantity: number;
              location: {
                id: string;
                name: string;
                parentId: string | null;
                _count?: { children?: number };
              } | null;
              assetKitId: string | null;
              assetKit: {
                id: string;
                kit: { id: string; name: string };
              } | null;
            };
            const placements = ((asset.assetLocations ?? []) as Placement[])
              .filter((al) => al.location?.id && al.location?.name)
              .map((al) => ({
                locationId: al.location!.id,
                locationName: al.location!.name,
                parentId: al.location!.parentId,
                childCount: al.location!._count?.children ?? 0,
                quantity: al.quantity ?? 0,
                // Kit-driven rows render a "via {kit}" badge and are
                // NOT editable from the manage-placements dialog. The
                // kit info comes from the nested AssetKit → Kit
                // relation pulled by `getAssetOverviewFields`.
                viaKit: al.assetKit?.kit ?? null,
              }));
            if (placements.length === 0) return null;
            const isQty = isQuantityTracked(asset);
            const unit = asset.unitOfMeasure || "units";
            return (
              <Card className="my-3 py-3 md:border">
                <div className="flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gray-100/50">
                    <div className="flex size-7 items-center justify-center rounded-full bg-gray-200">
                      <Icon icon="location" />
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {placements.length > 1
                          ? "Placed at locations"
                          : "Placed at location"}
                      </h3>
                      {isQty && canEditAsset ? (
                        <Button
                          to="manage-placements"
                          variant="link"
                          className="shrink-0 text-xs font-normal text-gray-500 underline hover:text-gray-700"
                        >
                          Edit placements
                        </Button>
                      ) : null}
                    </div>
                    <ul className="space-y-1">
                      {placements.map((p) => (
                        <li
                          key={`${p.locationId}-${p.viaKit?.id ?? "manual"}`}
                          className="flex items-center justify-between gap-2"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Button
                              to={`/locations/${p.locationId}`}
                              role="link"
                              variant="link"
                              className="min-w-0 justify-start truncate text-sm font-normal text-gray-700 underline hover:text-gray-700"
                              target="_blank"
                            >
                              <span className="truncate">{p.locationName}</span>
                            </Button>
                            {p.viaKit ? (
                              <TooltipProvider delayDuration={150}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      to={`/kits/${p.viaKit.id}`}
                                      role="link"
                                      variant="link"
                                      target="_blank"
                                      className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 no-underline hover:bg-blue-100 hover:text-blue-800"
                                    >
                                      via kit
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="top"
                                    className="max-w-xs"
                                  >
                                    <p className="text-xs font-semibold text-gray-700">
                                      {p.viaKit.name}
                                    </p>
                                    <p className="mt-1 text-xs text-gray-500">
                                      These units are at this location because
                                      the asset is in this kit. Change the
                                      kit&apos;s location to move them.
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {isQty ? (
                              <span className="text-xs tabular-nums text-gray-500">
                                {p.quantity} {unit}
                              </span>
                            ) : null}
                            {/*
                             * Move-units affordance — manual rows only. Kit-driven
                             * rows (`viaKit`) must be moved via the `kit` axis
                             * because their quantity is derived from `AssetKit`,
                             * not editable directly. Gated on edit permission +
                             * QUANTITY_TRACKED so INDIVIDUAL assets don't see it.
                             */}
                            {isQty && canEditAsset && !p.viaKit ? (
                              <MoveUnitsDialog
                                axis="location"
                                assetId={asset.id}
                                assetTitle={asset.title}
                                unitOfMeasure={asset.unitOfMeasure}
                                fromLocation={{
                                  id: p.locationId,
                                  name: p.locationName,
                                  quantity: p.quantity,
                                }}
                                destinations={moveDestinations.locations.filter(
                                  (l) => l.id !== p.locationId
                                )}
                                actionUrl={moveUnitsActionUrl}
                                trigger={
                                  <Button
                                    type="button"
                                    variant="link"
                                    className="text-xs font-normal text-gray-500 underline hover:text-gray-700"
                                  >
                                    Move
                                  </Button>
                                }
                              />
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Card>
            );
          })()}

          {!isQuantityTracked(asset) ? (
            <CustodyCard
              booking={booking}
              custody={asset?.custody || null}
              hasPermission={userCanViewSpecificCustody({
                roles,
                custodianUserId: getPrimaryCustody(asset?.custody)?.custodian
                  ?.user?.id,
                organization: currentOrganization,
                currentUserId: userId,
              })}
            />
          ) : null}

          {isQuantityTracked(asset) ? (
            <QuantityOverviewCard
              assetId={asset.id}
              quantity={asset.quantity ?? null}
              unitOfMeasure={asset.unitOfMeasure ?? null}
              minQuantity={asset.minQuantity ?? null}
              consumptionType={asset.consumptionType ?? null}
              availableQuantity={quantityData?.available}
              custodyAvailableQuantity={quantityData?.custodyAvailable}
              inCustodyQuantity={quantityData?.inCustody}
              inKitsQuantity={quantityData?.inKits}
              inLocationsQuantity={quantityData?.inLocations}
              reservedQuantity={quantityData?.reserved}
              checkedOutQuantity={quantityData?.checkedOut}
              canUpdate={canUpdateAvailability}
            />
          ) : null}

          {/*
           * Place-unplaced CTA. Sits outside QuantityOverviewCard because
           * that card is read-only and shared by other surfaces — adding
           * an action would broaden its prop surface. Renders only when
           * there are unplaced units AND the user can edit the asset.
           */}
          {isQuantityTracked(asset) && canEditAsset && unplacedQuantity > 0 ? (
            <Card className="my-3 px-4 py-3 md:border">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-gray-600">
                  <span className="font-semibold text-gray-900">
                    {unplacedQuantity} {asset.unitOfMeasure || "units"}
                  </span>{" "}
                  currently unplaced.
                </p>
                <MoveUnitsDialog
                  axis="place-unplaced"
                  assetId={asset.id}
                  assetTitle={asset.title}
                  unitOfMeasure={asset.unitOfMeasure}
                  unplacedQuantity={unplacedQuantity}
                  destinations={moveDestinations.locations}
                  actionUrl={moveUnitsActionUrl}
                  trigger={
                    <Button
                      type="button"
                      variant="secondary"
                      className="py-1 text-xs"
                    >
                      Place them
                    </Button>
                  }
                />
              </div>
            </Card>
          ) : null}

          {isQuantityTracked(asset) ? (
            <QuantityCustodyList
              custody={asset.custody}
              assetId={asset.id}
              unitOfMeasure={asset.unitOfMeasure}
              availableQuantity={quantityData?.custodyAvailable}
              isSelfService={isSelfService}
              currentUserId={userId}
              canViewAllCustody={canViewAllCustody}
              canCustody={canCustody}
              inKit={getPrimaryKit<{ id: string; name: string }>(asset)}
            />
          ) : null}

          {asset && (
            <CodePreview
              qrObj={qrObj}
              barcodes={
                canUseBarcodes
                  ? (asset as AssetWithOptionalBarcodes).barcodes || []
                  : []
              }
              item={{
                id: asset.id,
                name: asset.title,
                type: "asset",
              }}
              sequentialId={asset.sequentialId}
            />
          )}
          <When
            truthy={userHasPermission({
              roles,
              entity: PermissionEntity.scan,
              action: PermissionAction.read,
            })}
          >
            <ScanDetails lastScan={lastScan} />
          </When>
        </div>
      </div>
    </div>
  );
}

/**
 * Small helper for BOOLEAN custom fields.
 * Supports tri-state: yes / no / unset (empty string).
 * When `isUnset` is true the hidden input sends "" which
 * `buildCustomFieldValue` treats as undefined (no value stored).
 * This prevents "Not set" booleans from being forced to "no" on save.
 */
function BooleanCustomFieldEditor({
  name,
  label,
  initialChecked,
  initialIsUnset = false,
}: {
  name: string;
  label: string;
  // why: named `initialChecked` / `initialIsUnset` rather than the more
  // common `defaultChecked` / `defaultIsUnset` so they don't get treated
  // as controlled-input defaults that should sync — once the user
  // toggles, local state owns the value. Also silences react-doctor's
  // `no-derived-useState` heuristic, which flags `default*`-named
  // props seeded into useState as derived-state-in-disguise.
  initialChecked: boolean;
  initialIsUnset?: boolean;
}) {
  const [isUnset, setIsUnset] = useState(initialIsUnset);
  const [checked, setChecked] = useState(initialChecked);
  return (
    <div className="flex items-center gap-2">
      <input
        type="hidden"
        name={name}
        value={isUnset ? "" : checked ? "yes" : "no"}
      />
      <Switch
        aria-label={label}
        checked={!isUnset && checked}
        onCheckedChange={(val) => {
          setIsUnset(false);
          setChecked(val);
        }}
      />
      <span className="text-sm text-gray-600">
        {isUnset ? `${label} (not set)` : label}
      </span>
      {/*
       * Clear is only offered when the field was originally unset
       * (initialIsUnset === true) and the user has just toggled the Switch on,
       * so they can revert without committing a yes/no value. Once cleared, the
       * only way back is to flip the Switch — which automatically un-sets
       * isUnset via the onCheckedChange handler above.
       */}
      {!isUnset && initialIsUnset && (
        <button
          type="button"
          onClick={() => setIsUnset(true)}
          className="text-xs text-gray-400 underline hover:text-gray-600"
        >
          Clear
        </button>
      )}
    </div>
  );
}
