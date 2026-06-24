import { AssetStatus, OrganizationRoles } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
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
        assets: {
          select: {
            id: true,
            title: true,
            status: true,
            mainImage: true,
            kitId: true,
            category: {
              select: { id: true, name: true, color: true },
            },
            kit: {
              select: { id: true, name: true },
            },
          },
          orderBy: [{ status: "desc" }, { createdAt: "asc" }],
        },
        _count: {
          select: { assets: true },
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

    // Compute booking capability flags
    const checkedOutCount = booking.assets.filter(
      (a) => a.status === AssetStatus.CHECKED_OUT
    ).length;
    const totalAssets = booking.assets.length;

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
      (role === OrganizationRoles.ADMIN &&
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
    const [canCancelPerm, canArchivePerm, canCreatePerm] = await Promise.all([
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
      // Delete: admin/owner any status; self-service/base only on DRAFT
      // (mirrors the web client gate; the server endpoint enforces ownership
      // + the same BASE-only-DRAFT rule).
      canDelete:
        (isBaseOrSelfService && booking.status === "DRAFT") ||
        !isBaseOrSelfService,
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
        assets: booking.assets,
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
