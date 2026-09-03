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
import type { ResolvedDisplayCode } from "~/modules/barcode/display";
import { resolveDisplayCode } from "~/modules/barcode/display";
import { ShelfError } from "~/utils/error";
import type { UserNameFields } from "~/utils/user";
import { getPrimaryLocation } from "../asset/utils";
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
          displayName: true;
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
              displayName: true;
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
    | "id"
    | "name"
    | "imageId"
    | "currency"
    | "updatedAt"
    // Read by `resolveDisplayCode` when building `assetIdToDisplayCodeMap`.
    | "qrIdDisplayPreference"
    | "barcodesEnabled"
  >;
  // QR code data URLs mapped by asset ID
  assetIdToQrCodeMap: Record<string, string>;
  /**
   * The code to PRINT under each QR image — the same one the workspace's
   * on-screen asset lists show: the QR id, the SAM id, or a barcode value,
   * with a per-asset override winning over the workspace preference. Keyed by
   * `Asset.id`.
   */
  assetIdToDisplayCodeMap: Record<string, ResolvedDisplayCode>;
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
  /**
   * What people OBSERVED — every COMMENT note, uncapped.
   *
   * Kept separate from `activityNotes` because they answer different
   * questions and only one of them is safe to truncate. A condition note is
   * the reason the audit was worth doing ("scuff on the left arm, still
   * usable"); dropping one silently removes evidence from the record this
   * PDF exists to be. Carries its asset so the receipt can group a note with
   * the photos of the same asset.
   */
  conditionNotes: (AuditNote & {
    user: (UserNameFields & { email: string }) | null;
    auditAsset: { asset: { id: string; title: string } | null } | null;
  })[];
  // Recent system activity (UPDATE rows only, limited to 15)
  activityNotes: (AuditNote & {
    user: (UserNameFields & { email: string }) | null;
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
            displayName: true,
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
                displayName: true,
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
          shouldBeCaptured: false,
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

    // `AuditNote` holds two unrelated things and they must not share a query.
    //
    // COMMENT rows are what a person typed about the condition of an asset.
    // UPDATE rows are the system trail ("X started this audit"), written as
    // Markdoc source. Reading both with one `take: 15` meant the trail — which
    // grows with every scan — crowded the observations out of the receipt, and
    // anything past the fifteenth was dropped without a word. On any audit
    // larger than a handful of assets the condition notes lost that race.
    const [conditionNotes, activityNotes] = await Promise.all([
      // Uncapped, and oldest first: this reads as a report, not a feed.
      db.auditNote.findMany({
        where: { auditSessionId, type: "COMMENT" },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
              email: true,
            },
          },
          // why: lets the receipt put a note and the photos of the same asset
          // in one place, instead of two sections the reader has to join up.
          auditAsset: {
            select: { asset: { select: { id: true, title: true } } },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      db.auditNote.findMany({
        where: { auditSessionId, type: "UPDATE" },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
    ]);

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
              assetLocations: {
                select: {
                  location: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
              // why: out of this rule — `getQrCodeMaps` renders the image from
              // `Qr.version`/`errorCorrection`, so the tight select cannot be used.
              qrCodes: true,
              // Feeds `resolveDisplayCode` so a barcode-preference workspace
              // gets its barcode value printed instead of the QR id.
              barcodes: { select: { id: true, type: true, value: true } },
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
          // Which code the workspace wants printed under the QR image.
          qrIdDisplayPreference: true,
          barcodesEnabled: true,
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

    // Merge audit status data into each asset, dropping the fetch-only
    // relations as we go: the code relations feed the two maps below, off the
    // raw rows, and `assetLocations` is reduced to `location` here. None of
    // them is read off a receipt row, so carrying them would only enlarge the
    // JSON the browser downloads. `getPrimaryLocation` reads the RAW row,
    // which still has `assetLocations`.
    const assetsWithAuditStatus: AssetWithAuditStatus[] = assets.map((raw) => {
      const {
        qrCodes: _qrCodes,
        barcodes: _barcodes,
        assetLocations: _assetLocations,
        ...asset
      } = raw;

      return {
        ...asset,
        location: getPrimaryLocation(raw),
        auditData: auditStatusMap.get(raw.id) || {
          expected: false,
          auditStatus: null,
        },
      };
    });

    // Generate QR code data URLs for each asset
    const assetIdToQrCodeMap = await getQrCodeMaps({
      assets,
      userId,
      organizationId,
      size: "small",
    });

    // Resolve off the same raw rows the QR map is built from, so the two maps
    // have one source. `assetsWithAuditStatus` is typed as a plain `Asset`,
    // which declares neither `qrCodes` nor `barcodes`, and every field on the
    // resolver's entity type is optional — so resolving from it would still
    // compile on the day those relations stop coming through.
    const assetIdToDisplayCodeMap: Record<string, ResolvedDisplayCode> =
      Object.fromEntries(
        assets.map((asset) => [
          asset.id,
          resolveDisplayCode({
            entity: asset,
            organization,
            entityKind: "asset",
          }),
        ])
      );

    return {
      session,
      assets: assetsWithAuditStatus,
      organization,
      assetIdToQrCodeMap,
      assetIdToDisplayCodeMap,
      generalImages,
      assetImages,
      conditionNotes,
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
