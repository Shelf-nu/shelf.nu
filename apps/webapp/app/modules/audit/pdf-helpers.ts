import type {
  Asset,
  Location,
  Category,
  Organization,
  AuditSession,
  OrganizationRoles,
  AuditImage,
  AuditNote,
  AuditAssetStatus,
  User,
  AuditAssignment,
} from "@shelf/database";
import { db } from "~/database/db.server";
import { findMany, findUnique } from "~/database/query-helpers.server";
import { ShelfError } from "~/utils/error";
import { getQrCodeMaps } from "../qr/service.server";

/**
 * Extended Asset type with audit-specific data for PDF generation
 */
export interface AssetWithAuditStatus extends Asset {
  category: Pick<Category, "id" | "name" | "color"> | null;
  location: Pick<Location, "name"> | null;
  // Audit-specific data: expected flag and current status
  auditData: {
    expected: boolean;
    auditStatus: AuditAssetStatus | null;
  };
}

/**
 * Complete data structure for audit PDF generation
 * Contains all information needed to render the audit receipt
 */
export interface AuditPdfDbResult {
  // Audit session with creator and assignees
  session: AuditSession & {
    createdBy: Pick<
      User,
      "firstName" | "lastName" | "email" | "profilePicture"
    >;
    assignments: (AuditAssignment & {
      user: Pick<
        User,
        "id" | "firstName" | "lastName" | "email" | "profilePicture"
      >;
    })[];
  };
  // Assets with audit status and metadata
  assets: AssetWithAuditStatus[];
  // Organization details for header
  organization: Pick<
    Organization,
    "id" | "name" | "imageId" | "currency" | "updatedAt"
  >;
  // QR code data URLs mapped by asset ID
  assetIdToQrCodeMap: Record<string, string>;
  // Images not linked to specific assets
  generalImages: AuditImage[];
  // Images linked to specific assets (grouped by auditAssetId)
  assetImages: (AuditImage & {
    auditAsset: {
      asset: {
        id: string;
        title: string;
      };
    } | null;
  })[];
  // Recent activity notes (limited to 15)
  activityNotes: (AuditNote & {
    user: {
      firstName: string | null;
      lastName: string | null;
      email: string;
    } | null;
  })[];
  // Formatted created date string (user's local timezone)
  from?: string;
  // Formatted completed date string (user's local timezone)
  to?: string;
}

/**
 * Fetches all data needed to generate an audit receipt PDF.
 * Includes audit session, assets, images, activity notes, and QR codes.
 *
 * @param auditSessionId - ID of the audit session
 * @param organizationId - Organization owning the audit
 * @param userId - Current user ID (for permission checks)
 * @param role - User's role in the organization
 * @param _request - HTTP request (unused but kept for API consistency)
 * @returns Complete audit data for PDF generation
 * @throws {ShelfError} If audit not found or permission denied
 */
export async function fetchAllAuditPdfRelatedData(
  auditSessionId: string,
  organizationId: string,
  userId: string,
  role: OrganizationRoles | undefined,
  _request: Request
): Promise<AuditPdfDbResult> {
  try {
    // Fetch audit session with creator and assignee information
    // TODO: convert Prisma include (createdBy, assignments.user) to Supabase join/select
    const session: any = await findUnique(db, "AuditSession" as any, {
      where: {
        id: auditSessionId,
        organizationId,
      },
      select:
        "*, createdBy:User!createdById(firstName, lastName, email, profilePicture), assignments:AuditAssignment(*, user:User!userId(id, firstName, lastName, email, profilePicture))",
    });

    if (!session) {
      throw new ShelfError({
        cause: null,
        message: "Audit session not found",
        status: 404,
        label: "Audit",
      });
    }

    // Permission check: BASE/SELF_SERVICE users can only view audits they're assigned to
    if (role && (role === "BASE" || role === "SELF_SERVICE")) {
      const isAssignee = session.assignments.some(
        (assignment) => assignment.user.id === userId
      );

      if (!isAssignee) {
        throw new ShelfError({
          cause: null,
          title: "Unauthorized",
          message: "You don't have permission to view this audit",
          status: 403,
          label: "Audit",
        });
      }
    }

    // Fetch all audit assets (both expected and unexpected)
    const auditAssets = await findMany(db, "AuditAsset" as any, {
      where: { auditSessionId },
      select: "assetId, expected, status",
    });

    const assetIds = auditAssets.map((aa) => aa.assetId);

    // Create lookup map for audit status data (expected flag + current status)
    const auditStatusMap = new Map(
      auditAssets.map((aa) => [
        aa.assetId,
        { expected: aa.expected, auditStatus: aa.status },
      ])
    );

    // Fetch all images for this audit with asset relationship
    // TODO: convert Prisma include (auditAsset.asset) to Supabase join/select
    const images: any[] = await findMany(db, "AuditImage" as any, {
      where: { auditSessionId },
      select:
        "*, auditAsset:AuditAsset!auditAssetId(id, asset:Asset!assetId(id, title))",
      orderBy: { createdAt: "asc" },
    });

    // Split images into general and asset-specific groups
    const generalImages = images.filter((img) => img.auditAssetId === null);
    const assetImages = images.filter((img) => img.auditAssetId !== null);

    // Fetch recent activity notes (limit to 15 most recent)
    // TODO: convert Prisma include (user) to Supabase join/select
    const activityNotes: any[] = await findMany(db, "AuditNote" as any, {
      where: { auditSessionId },
      select: "*, user:User!userId(firstName, lastName, email)",
      orderBy: { createdAt: "desc" },
      take: 15,
    });

    // Fetch assets and organization details in parallel for efficiency
    // TODO: convert Prisma include (category, location, qrCodes) to Supabase join/select
    const [assets, organization] = await Promise.all([
      assetIds.length > 0
        ? findMany(db, "Asset", {
            where: {
              id: { in: assetIds },
              organizationId,
            },
            select:
              "*, category:Category!categoryId(id, name, color), location:Location!locationId(name), qrCodes:Qr(*)",
          })
        : Promise.resolve([]),
      findUnique(db, "Organization", {
        where: { id: organizationId },
        select: "id, name, imageId, currency, updatedAt",
      }),
    ]);

    if (!organization) {
      throw new ShelfError({
        cause: null,
        message: "Organization not found",
        status: 404,
        label: "Organization",
      });
    }

    // Merge audit status data into each asset
    const assetsWithAuditStatus: AssetWithAuditStatus[] = assets.map(
      (asset) => ({
        ...asset,
        auditData: auditStatusMap.get(asset.id) || {
          expected: false,
          auditStatus: null,
        },
      })
    );

    // Generate QR code data URLs for each asset
    const assetIdToQrCodeMap = await getQrCodeMaps({
      assets,
      userId,
      organizationId,
      size: "small",
    });

    return {
      session,
      assets: assetsWithAuditStatus,
      organization,
      assetIdToQrCodeMap,
      generalImages,
      assetImages,
      activityNotes,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Error fetching audit data for PDF",
      status: 500,
      label: "Audit",
    });
  }
}
