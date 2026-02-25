import type {
  Asset,
  Location,
  Category,
  Organization,
  Prisma,
  OrganizationRoles,
  AuditImage,
  AuditNote,
  AuditAssetStatus,
} from "@prisma/client";
import { db } from "~/database/db.server";
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
  session: Prisma.AuditSessionGetPayload<{
    include: {
      createdBy: {
        select: {
          firstName: true;
          lastName: true;
          email: true;
          profilePicture: true;
        };
      };
      assignments: {
        include: {
          user: {
            select: {
              id: true;
              firstName: true;
              lastName: true;
              email: true;
              profilePicture: true;
            };
          };
        };
      };
    };
  }>;
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
    const session = await db.auditSession.findUnique({
      where: {
        id: auditSessionId,
        organizationId,
      },
      include: {
        createdBy: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            profilePicture: true,
          },
        },
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                profilePicture: true,
              },
            },
          },
        },
      },
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
    const auditAssets = await db.auditAsset.findMany({
      where: { auditSessionId },
      select: {
        assetId: true,
        expected: true,
        status: true,
      },
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
    const images = await db.auditImage.findMany({
      where: { auditSessionId },
      include: {
        auditAsset: {
          select: {
            id: true,
            asset: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Split images into general and asset-specific groups
    const generalImages = images.filter((img) => img.auditAssetId === null);
    const assetImages = images.filter((img) => img.auditAssetId !== null);

    // Fetch recent activity notes (limit to 15 most recent)
    const activityNotes = await db.auditNote.findMany({
      where: { auditSessionId },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 15,
    });

    // Fetch assets and organization details in parallel for efficiency
    const [assets, organization] = await Promise.all([
      assetIds.length > 0
        ? db.asset.findMany({
            where: {
              id: { in: assetIds },
              organizationId,
            },
            include: {
              category: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                },
              },
              location: {
                select: {
                  name: true,
                },
              },
              qrCodes: true,
            },
          })
        : Promise.resolve([]),
      db.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          imageId: true,
          currency: true,
          updatedAt: true,
        },
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
