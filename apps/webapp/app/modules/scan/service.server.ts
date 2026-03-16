import { sbDb } from "~/database/supabase.server";
import { ShelfError } from "~/utils/error";
import type { ErrorLabel } from "~/utils/error";
import { wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import { createNote } from "../note/service.server";
import { getOrganizationById } from "../organization/service.server";
import { getQr } from "../qr/service.server";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Scan";

export async function createScan(params: {
  userAgent: string;
  userId?: string | null;
  qrId: string;
  deleted?: boolean;
  latitude?: string | null;
  longitude?: string | null;
  manuallyGenerated?: boolean;
}) {
  const {
    userAgent,
    userId,
    qrId,
    deleted = false,
    latitude = null,
    longitude = null,
    manuallyGenerated = false,
  } = params;

  try {
    const insertData: Record<string, unknown> = {
      userAgent,
      rawQrId: qrId,
      latitude,
      longitude,
      manuallyGenerated,
    };

    if (userId && userId != "anonymous") {
      insertData.userId = userId;
    }

    if (!deleted) {
      insertData.qrId = qrId;
    }

    const { data: scan, error } = await sbDb
      .from("Scan")
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    await createScanNote({
      userId,
      qrId,
      longitude,
      latitude,
      manuallyGenerated,
    });

    return scan;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating a scan. Please try again or contact support.",
      additionalData: { params },
      label,
    });
  }
}

export async function updateScan(params: {
  id: string;
  userId?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  manuallyGenerated?: boolean;
}) {
  const { id, userId, latitude = null, longitude = null } = params;

  try {
    const updateData: Record<string, unknown> = {
      latitude,
      longitude,
    };

    if (userId) {
      updateData.userId = userId;
    }

    const { data, error } = await sbDb
      .from("Scan")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while updating the scan. Please try again or contact support.",
      additionalData: { params },
      label,
    });
  }
}

export async function getScanByQrId({ qrId }: { qrId: string }) {
  try {
    const { data, error } = await sbDb
      .from("Scan")
      .select(
        "*, user:User(*, userOrganizations:UserOrganization(*)), qr:Qr(*)"
      )
      .eq("rawQrId", qrId)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the scan",
      additionalData: { qrId },
      label,
    });
  }
}

export async function createScanNote({
  userId,
  qrId,
  latitude,
  longitude,
  manuallyGenerated,
}: {
  userId?: string | null;
  qrId: string;
  latitude?: string | null;
  longitude?: string | null;
  manuallyGenerated?: boolean;
}) {
  try {
    let message = "";
    const { assetId, organizationId } = await getQr({ id: qrId });
    if (assetId && organizationId) {
      let hasAccess = false;
      let authenticatedUserId: string | null = null;

      if (userId && userId !== "anonymous") {
        authenticatedUserId = userId;

        const { count, error } = await sbDb
          .from("UserOrganization")
          .select("*", { count: "exact", head: true })
          .eq("userId", authenticatedUserId)
          .eq("organizationId", organizationId);

        if (error) throw error;
        hasAccess = (count ?? 0) > 0;
      }

      if (hasAccess && authenticatedUserId) {
        const { firstName, lastName } = await getUserByID(authenticatedUserId, {
          select: {
            firstName: true,
            lastName: true,
          },
        });
        const actor = wrapUserLinkForNote({
          id: authenticatedUserId,
          firstName,
          lastName,
        });
        if (manuallyGenerated) {
          message = `${actor} manually updated the GPS coordinates to *${latitude}, ${longitude}*.`;
        } else {
          message = `${actor} performed a scan of the asset QR code.`;
        }

        return await createNote({
          content: message,
          type: "UPDATE",
          userId: authenticatedUserId,
          assetId,
        });
      } else {
        const { userId: ownerId } = await getOrganizationById(organizationId);
        message = "An unknown user has performed a scan of the asset QR code.";

        return await createNote({
          content: message,
          type: "UPDATE",
          userId: ownerId,
          assetId,
        });
      }
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating a scan note",
      additionalData: { userId, qrId, latitude, longitude, manuallyGenerated },
      label,
    });
  }
}
