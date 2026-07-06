import { AssetStatus, OrganizationRoles } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { getPartiallyCheckedInAssetIds } from "~/modules/booking/service.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { hasPermission } from "~/utils/permissions/permission.validator.server";

/**
 * GET /api/mobile/bookings/:bookingId
 *
 * Returns full booking detail with assets, custodian, and check-in status.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    // Bookings are a TEAM-tier (premium) feature — gate the detail read like the
    // mutation/check-in routes so a PERSONAL workspace can't fetch booking
    // details, assets, tags and action flags via mobile.
    await assertMobileCanUseBookings(organizationId);

    // Self-service / base users may only read their OWN bookings. Scope the
    // lookup by custodian like the list endpoint (bookings.ts) does, so a
    // booking they don't own 404s instead of leaking across the workspace.
    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;

    const { bookingId } = getParams(
      params,
      z.object({ bookingId: z.string().min(1) })
    );

    const booking = await db.booking.findFirst({
      where: {
        id: bookingId,
        organizationId,
        ...(isSelfServiceOrBase && { custodianUserId: user.id }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        from: true,
        to: true,
        createdAt: true,
        updatedAt: true,
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        custodianUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
          },
        },
        custodianTeamMember: {
          select: {
            id: true,
            name: true,
          },
        },
        tags: {
          select: { id: true, name: true },
        },
        // Walk the BookingAsset pivot to reach assets. `quantity` +
        // `assetKitId` per row let the loader below collapse multi-row
        // entries (standalone + kit-driven slices of the same asset)
        // into one mobile-shape entry per asset.
        bookingAssets: {
          select: {
            id: true,
            quantity: true,
            assetKitId: true,
            asset: {
              select: {
                id: true,
                title: true,
                status: true,
                mainImage: true,
                category: {
                  select: { id: true, name: true, color: true },
                },
                // Pull the asset's kit memberships through the `AssetKit`
                // pivot. `id` so we can match the BookingAsset's
                // `assetKitId` against the right membership when collapsing.
                assetKits: {
                  select: {
                    id: true,
                    kit: { select: { id: true, name: true } },
                  },
                  orderBy: { createdAt: "asc" },
                },
              },
            },
          },
          orderBy: [
            { asset: { status: "desc" } },
            { asset: { createdAt: "asc" } },
          ],
        },
        _count: {
          select: { bookingAssets: true },
        },
      },
    });

    if (!booking) {
      return data({ error: { message: "Booking not found" } }, { status: 404 });
    }

    // Get partial check-in data for ONGOING/OVERDUE bookings
    let checkedInAssetIds: string[] = [];
    if (booking.status === "ONGOING" || booking.status === "OVERDUE") {
      checkedInAssetIds = await getPartiallyCheckedInAssetIds(booking.id);
    }

    // Collapse multi-row BookingAsset entries to one mobile shape per
    // `assetId`. Sum the quantities; expose `assetKitId` only when
    // every row for the asset agrees on the same kit (otherwise `null`
    // = mixed standalone + kit-driven). Mobile clients that don't know
    // about `assetKitId` see the same flat shape they always did.
    //
    // `kit`/`kitId` keep their legacy synthesis (the first AssetKit
    // pointer the asset has at booking time) for older clients that
    // still rely on those — but the `assetKitId` field is the accurate
    // per-booking-slice signal when mobile is ready to adopt it.
    type CollapsedRow = {
      assetId: string;
      first: (typeof booking.bookingAssets)[number];
      totalQuantity: number;
      assetKitIds: Set<string | null>;
    };
    const byAssetId = new Map<string, CollapsedRow>();
    for (const ba of booking.bookingAssets) {
      const existing = byAssetId.get(ba.asset.id);
      if (existing) {
        existing.totalQuantity += ba.quantity;
        existing.assetKitIds.add(ba.assetKitId);
      } else {
        byAssetId.set(ba.asset.id, {
          assetId: ba.asset.id,
          first: ba,
          totalQuantity: ba.quantity,
          assetKitIds: new Set([ba.assetKitId]),
        });
      }
    }

    const assets = Array.from(byAssetId.values()).map((row) => {
      const { assetKits, ...rest } = row.first.asset;
      const primaryKit = assetKits[0]?.kit ?? null;
      // Unanimous-kit rule: every collapsed row for this asset points at
      // the same `assetKitId`. Mixed → `null` so clients don't
      // mis-attribute the slice to one of multiple sources.
      const unanimousAssetKitId =
        row.assetKitIds.size === 1 ? Array.from(row.assetKitIds)[0] : null;
      return {
        ...rest,
        kit: primaryKit,
        kitId: primaryKit?.id ?? null,
        // Per-booking quantity (sum of all slices for this asset in
        // this booking).
        quantity: row.totalQuantity,
        // Per-row kit-source discriminator — `null` for standalone or
        // mixed (assets with both standalone and kit-driven slices).
        assetKitId: unanimousAssetKitId,
      };
    });

    // Compute booking capability flags
    const checkedOutCount = assets.filter(
      (a) => a.status === AssetStatus.CHECKED_OUT
    ).length;
    const totalAssets = assets.length;

    const canCheckout = booking.status === "RESERVED" && totalAssets > 0;
    const canCheckin =
      (booking.status === "ONGOING" || booking.status === "OVERDUE") &&
      checkedOutCount > 0;

    // Quick "check in all" is disallowed when the workspace requires EXPLICIT
    // (scan/select) check-in for the caller's role — mirror the web policy
    // (overview.tsx:1034-1054) so the app never offers an action the web /
    // workspace settings forbid.
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);
    const canQuickCheckin = !(
      ((role === OrganizationRoles.ADMIN ||
        role === OrganizationRoles.BOOKING_MANAGER) &&
        bookingSettings.requireExplicitCheckinForAdmin) ||
      (role === OrganizationRoles.SELF_SERVICE &&
        bookingSettings.requireExplicitCheckinForSelfService)
    );

    // Per-booking lifecycle-action availability, mirroring the web
    // ActionsDropdown gating (actions-dropdown.tsx) so the app surfaces exactly
    // the actions this role/status can perform — never an option the web /
    // role / status forbids. Passing `roles:[role]` keeps `hasPermission` a
    // pure static-map lookup (no extra query). Server endpoints enforce these
    // same gates regardless; this is the UI mirror.
    const isBaseOrSelfService =
      role === OrganizationRoles.BASE ||
      role === OrganizationRoles.SELF_SERVICE;
    const [canCancelPerm, canArchivePerm, canCreatePerm, canDeletePerm] =
      await Promise.all([
        hasPermission({
          userId: user.id,
          organizationId,
          roles: [role],
          entity: PermissionEntity.booking,
          action: PermissionAction.cancel,
        }),
        hasPermission({
          userId: user.id,
          organizationId,
          roles: [role],
          entity: PermissionEntity.booking,
          action: PermissionAction.archive,
        }),
        hasPermission({
          userId: user.id,
          organizationId,
          roles: [role],
          entity: PermissionEntity.booking,
          action: PermissionAction.create,
        }),
        hasPermission({
          userId: user.id,
          organizationId,
          roles: [role],
          entity: PermissionEntity.booking,
          action: PermissionAction.delete,
        }),
      ]);
    const bookingActions = {
      // Cancel: RESERVED/ONGOING/OVERDUE + cancel permission.
      canCancel:
        (booking.status === "RESERVED" ||
          booking.status === "ONGOING" ||
          booking.status === "OVERDUE") &&
        canCancelPerm,
      // Archive: COMPLETE only + archive permission.
      canArchive: booking.status === "COMPLETE" && canArchivePerm,
      // Duplicate: any status; gated by create permission (web's duplicate
      // route enforces create — we hide it for those who lack it rather than
      // 403 on tap).
      canDuplicate: canCreatePerm,
      // Delete: requires the delete permission AND (admin/owner any status |
      // self-service/base only on DRAFT). Mirrors the web client gate; the
      // server endpoint enforces ownership + the same BASE-only-DRAFT rule.
      canDelete:
        ((isBaseOrSelfService && booking.status === "DRAFT") ||
          !isBaseOrSelfService) &&
        canDeletePerm,
    };

    return data({
      booking: {
        id: booking.id,
        name: booking.name,
        description: booking.description,
        status: booking.status,
        from: booking.from,
        to: booking.to,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        creator: booking.creator,
        custodianUser: booking.custodianUser,
        custodianTeamMember: booking.custodianTeamMember,
        tags: booking.tags,
        assets,
        assetCount: totalAssets,
        checkedOutCount,
      },
      checkedInAssetIds,
      canCheckout,
      canCheckin,
      canQuickCheckin,
      bookingActions,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
