import type {
  Asset,
  Location,
  Category,
  Organization,
  OrganizationRoles,
  AuditImage,
  AuditNote,
  AuditAssetStatus,
} from "@prisma/client";
import { sbDb } from "~/database/supabase.server";
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
  session: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    organizationId: string;
    createdById: string;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
    dueDate: string | null;
    expectedAssetCount: number;
    foundAssetCount: number;
    missingAssetCount: number;
    unexpectedAssetCount: number;
    scopeMeta: unknown;
    activeSchedulerReference: string | null;
    createdBy: {
      firstName: string | null;
      lastName: string | null;
      email: string;
      profilePicture: string | null;
    };
    assignments: {
      id: string;
      userId: string;
      auditSessionId: string;
      role: string | null;
      createdAt: string;
      user: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        email: string;
        profilePicture: string | null;
      };
    }[];
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
    const { data: session, error: sessionError } = await sbDb
      .from("AuditSession")
      .select(
        "*, createdBy:User!createdById(firstName, lastName, email, profilePicture), assignments:AuditAssignment(*, user:User!userId(id, firstName, lastName, email, profilePicture))"
      )
      .eq("id", auditSessionId)
      .eq("organizationId", organizationId)
      .single();

    if (sessionError) throw sessionError;

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
      const isAssignee = (session.assignments as unknown as any[]).some(
        (assignment: { user: { id: string } }) => assignment.user.id === userId
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
    const { data: auditAssets, error: auditAssetsError } = await sbDb
      .from("AuditAsset")
      .select("assetId, expected, status")
      .eq("auditSessionId", auditSessionId);

    if (auditAssetsError) throw auditAssetsError;

    const assetIds = (auditAssets ?? []).map((aa) => aa.assetId);

    // Create lookup map for audit status data (expected flag + current status)
    const auditStatusMap = new Map(
      (auditAssets ?? []).map((aa) => [
        aa.assetId,
        { expected: aa.expected, auditStatus: aa.status },
      ])
    );

    // Fetch all images for this audit with asset relationship
    const { data: images, error: imagesError } = await sbDb
      .from("AuditImage")
      .select(
        "*, auditAsset:AuditAsset!auditAssetId(id, asset:Asset!assetId(id, title))"
      )
      .eq("auditSessionId", auditSessionId)
      .order("createdAt", { ascending: true });

    if (imagesError) throw imagesError;

    // Split images into general and asset-specific groups
    const generalImages = (images ?? []).filter(
      (img) => img.auditAssetId === null
    );
    const assetImages = (images ?? []).filter(
      (img) => img.auditAssetId !== null
    );

    // Fetch recent activity notes (limit to 15 most recent)
    const { data: activityNotes, error: notesError } = await sbDb
      .from("AuditNote")
      .select("*, user:User!userId(firstName, lastName, email)")
      .eq("auditSessionId", auditSessionId)
      .order("createdAt", { ascending: false })
      .limit(15);

    if (notesError) throw notesError;

    // Fetch assets and organization details in parallel for efficiency
    let assets: any[] = [];
    if (assetIds.length > 0) {
      const { data: assetData, error: assetError } = await sbDb
        .from("Asset")
        .select(
          "*, category:Category(id, name, color), location:Location(name), qrCodes:Qr(*)"
        )
        .eq("organizationId", organizationId)
        .in("id", assetIds);

      if (assetError) throw assetError;
      assets = assetData ?? [];
    }

    const { data: organization, error: orgError } = await sbDb
      .from("Organization")
      .select("id, name, imageId, currency, updatedAt")
      .eq("id", organizationId)
      .single();

    if (orgError) throw orgError;

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
      session: session as any,
      assets: assetsWithAuditStatus,
      organization: organization as any,
      assetIdToQrCodeMap,
      generalImages: generalImages as any,
      assetImages: assetImages as any,
      activityNotes: activityNotes as any,
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
