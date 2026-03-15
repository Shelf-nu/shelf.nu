import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { db } from "~/database/db.server";
import { findMany } from "~/database/query-helpers.server";
import { queryRaw, sql, join, type SqlFragment } from "~/database/sql.server";
import { getAssets } from "~/modules/asset/service.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
});

/**
 * Builds ILIKE search condition using raw SQL for column references.
 * This avoids issues with parameterizing column names.
 */
function buildSearchWhere(
  searchTerms: string[],
  columns: { name: string; alias?: string }[]
): SqlFragment {
  if (searchTerms.length === 0) return sql`TRUE`;

  const termFragments = searchTerms.map((term) => {
    const colFragments = columns.map((col) => {
      const colRef = col.alias ? `${col.alias}."${col.name}"` : `"${col.name}"`;
      return new SqlFragment(`${colRef} ILIKE $1`, ["%" + term + "%"]);
    });
    return sql`(${join(colFragments, " OR ")})`;
  });

  return join(termFragments, " OR ");
}

// Type for kit queryRaw results
interface KitRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  assetCount: number;
}

// Type for booking queryRaw results
interface BookingRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  from: string | null;
  to: string | null;
  custodianUserFirstName: string | null;
  custodianUserLastName: string | null;
  custodianTeamMemberName: string | null;
}

// Type for location queryRaw results
interface LocationRow {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  assetCount: number;
}

// Type for team member queryRaw results
interface TeamMemberRow {
  id: string;
  name: string;
  userId: string | null;
  userEmail: string | null;
  userFirstName: string | null;
  userLastName: string | null;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const url = new URL(request.url);
    const validated = querySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
    });
    const query = validated.q?.trim() ?? "";

    if (!query) {
      return data(
        payload({
          query,
          assets: [],
          audits: [],
          kits: [],
          bookings: [],
          locations: [],
          teamMembers: [],
        })
      );
    }

    const {
      organizationId,
      role,
      canSeeAllBookings,
      canSeeAllCustody,
      isSelfServiceOrBase,
      currentOrganization,
    } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.commandPaletteSearch,
      action: PermissionAction.read,
    });

    const terms = query
      .split(/[\s,]+/)
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 5);

    const searchTerms = terms.length > 0 ? terms : [query];

    // Check if this is a personal workspace - they don't have bookings or team members
    const isPersonalWorkspace = isPersonalOrg(currentOrganization);

    // Check permissions for different entity types based on actual roles
    const hasKitPermission = ["OWNER", "ADMIN"].includes(role);
    const hasBookingPermission =
      !isPersonalWorkspace &&
      ["OWNER", "ADMIN", "SELF_SERVICE", "BASE"].includes(role);
    const hasLocationPermission = ["OWNER", "ADMIN"].includes(role);
    const hasTeamMemberPermission =
      !isPersonalWorkspace && ["OWNER", "ADMIN"].includes(role);
    const hasAuditPermission = true;

    // Build audit search where clause for findMany helper
    const auditSearchConditions = searchTerms.map((term) => ({
      OR: [
        { name: { contains: term, mode: "insensitive" as const } },
        { description: { contains: term, mode: "insensitive" as const } },
        { id: { contains: term, mode: "insensitive" as const } },
      ],
    }));

    const auditWhere: Record<string, any> = {
      organizationId,
      ...(auditSearchConditions.length ? { OR: auditSearchConditions } : {}),
      ...(isSelfServiceOrBase && userId
        ? {
            assignments: {
              some: {
                userId,
              },
            },
          }
        : {}),
    };

    // Build SQL search conditions for queryRaw calls
    const kitSearchWhere = buildSearchWhere(searchTerms, [
      { name: "name", alias: "k" },
      { name: "description", alias: "k" },
      { name: "id", alias: "k" },
    ]);

    const bookingSearchWhere = buildSearchWhere(searchTerms, [
      { name: "name", alias: "b" },
      { name: "description", alias: "b" },
      { name: "id", alias: "b" },
    ]);

    const locationSearchWhere = buildSearchWhere(searchTerms, [
      { name: "name", alias: "l" },
      { name: "description", alias: "l" },
      { name: "address", alias: "l" },
      { name: "id", alias: "l" },
    ]);

    const teamMemberSearchWhere = buildSearchWhere(searchTerms, [
      { name: "name", alias: "tm" },
      { name: "id", alias: "tm" },
      { name: "firstName", alias: "u" },
      { name: "lastName", alias: "u" },
      { name: "email", alias: "u" },
    ]);

    // Execute parallel searches
    const [assetResults, audits, kits, bookings, locations, teamMembers] =
      await Promise.all([
        // Assets (always allowed) - using enhanced search from asset service
        getAssets({
          search: query,
          organizationId,
          page: 1,
          orderBy: "title",
          orderDirection: "asc",
          perPage: 8,
          extraInclude: {
            barcodes: {
              select: { id: true, value: true, type: true },
            },
          },
        }),

        // Audits (permission-gated) — simple select, uses findMany helper
        hasAuditPermission
          ? findMany(db, "AuditSession", {
              where: auditWhere,
              select: "id, name, description, status, dueDate",
              orderBy: { updatedAt: "desc" },
              take: 6,
            })
          : Promise.resolve([]),

        // Kits (permission-gated) — needs asset count via LEFT JOIN
        hasKitPermission
          ? queryRaw<KitRow>(
              db,
              sql`
              SELECT k."id", k."name", k."description", k."status",
                     COUNT(a."id")::int AS "assetCount"
              FROM "Kit" k
              LEFT JOIN "Asset" a ON a."kitId" = k."id"
              WHERE k."organizationId" = ${organizationId}
                AND (${kitSearchWhere})
              GROUP BY k."id"
              ORDER BY k."updatedAt" DESC, k."name" ASC
              LIMIT 6
            `
            )
          : Promise.resolve([]),

        // Bookings (permission-gated) — needs custodian user/team member via JOINs
        hasBookingPermission
          ? queryRaw<BookingRow>(
              db,
              sql`
              SELECT b."id", b."name", b."description", b."status",
                     b."from", b."to",
                     cu."firstName" AS "custodianUserFirstName",
                     cu."lastName" AS "custodianUserLastName",
                     ctm."name" AS "custodianTeamMemberName"
              FROM "Booking" b
              LEFT JOIN "User" cu ON cu."id" = b."custodianUserId"
              LEFT JOIN "TeamMember" ctm ON ctm."id" = b."custodianTeamMemberId"
              WHERE b."organizationId" = ${organizationId}
                AND (${bookingSearchWhere})
                ${
                  canSeeAllBookings
                    ? sql``
                    : sql`AND b."custodianUserId" = ${userId}`
                }
              ORDER BY b."updatedAt" DESC, b."name" ASC
              LIMIT 6
            `
            )
          : Promise.resolve([]),

        // Locations (permission-gated) — needs asset count via LEFT JOIN
        hasLocationPermission
          ? queryRaw<LocationRow>(
              db,
              sql`
              SELECT l."id", l."name", l."description", l."address",
                     COUNT(a."id")::int AS "assetCount"
              FROM "Location" l
              LEFT JOIN "Asset" a ON a."locationId" = l."id"
              WHERE l."organizationId" = ${organizationId}
                AND (${locationSearchWhere})
              GROUP BY l."id"
              ORDER BY l."updatedAt" DESC, l."name" ASC
              LIMIT 6
            `
            )
          : Promise.resolve([]),

        // Team members (permission-gated) — needs user info + complex custody filter
        hasTeamMemberPermission
          ? queryRaw<TeamMemberRow>(
              db,
              sql`
              SELECT tm."id", tm."name", tm."userId",
                     u."email" AS "userEmail",
                     u."firstName" AS "userFirstName",
                     u."lastName" AS "userLastName"
              FROM "TeamMember" tm
              LEFT JOIN "User" u ON u."id" = tm."userId"
              WHERE tm."organizationId" = ${organizationId}
                AND tm."deletedAt" IS NULL
                AND (${teamMemberSearchWhere})
                ${
                  canSeeAllCustody
                    ? sql``
                    : sql`AND (
                    EXISTS (
                      SELECT 1 FROM "Custody" c
                      JOIN "TeamMember" cust ON cust."id" = c."teamMemberId"
                      WHERE c."teamMemberId" = tm."id"
                        AND cust."userId" = ${userId}
                    )
                    OR EXISTS (
                      SELECT 1 FROM "KitCustody" kc
                      JOIN "TeamMember" cust2 ON cust2."id" = kc."custodianId"
                      WHERE kc."custodianId" = tm."id"
                        AND cust2."userId" = ${userId}
                    )
                    OR tm."userId" = ${userId}
                  )`
                }
              ORDER BY tm."updatedAt" DESC, tm."name" ASC
              LIMIT 8
            `
            )
          : Promise.resolve([]),
      ]);

    return data(
      payload({
        query,
        assets: assetResults.assets.map((asset) => ({
          id: asset.id,
          title: asset.title,
          sequentialId: asset.sequentialId,
          mainImage: asset.mainImage,
          mainImageExpiration: asset.mainImageExpiration?.toISOString() ?? null,
          locationName: asset.location?.name ?? null,
          description: asset.description,
          qrCodes: asset.qrCodes?.map((qr) => qr.id) ?? [],
          categoryName: asset.category?.name ?? null,
          tagNames: asset.tags?.map((tag) => tag.name) ?? [],
          custodianName: (asset.custody as any)?.custodian?.name ?? null,
          custodianUserName: (asset.custody as any)?.custodian?.user
            ? `${(asset.custody as any).custodian.user.firstName} ${
                (asset.custody as any).custodian.user.lastName
              }`.trim()
            : null,
          barcodes: asset.barcodes?.map((barcode) => barcode.value) ?? [],
          customFieldValues:
            asset.customFields
              ?.map((cf) => {
                const value = cf.value as any;
                const extractedValue = value?.raw ?? value ?? "";
                return String(extractedValue);
              })
              .filter(Boolean) ?? [],
        })),
        audits: audits.map((audit: any) => ({
          id: audit.id,
          name: audit.name,
          description: audit.description || null,
          status: audit.status,
          dueDate: audit.dueDate ? new Date(audit.dueDate).toISOString() : null,
        })),
        kits: kits.map((kit: KitRow) => ({
          id: kit.id,
          name: kit.name,
          description: kit.description || null,
          status: kit.status,
          assetCount: kit.assetCount || 0,
        })),
        bookings: bookings.map((booking: BookingRow) => ({
          id: booking.id,
          name: booking.name,
          description: booking.description || null,
          status: booking.status,
          custodianName: booking.custodianUserFirstName
            ? `${booking.custodianUserFirstName} ${
                booking.custodianUserLastName || ""
              }`.trim()
            : booking.custodianTeamMemberName || null,
          from: booking.from ? new Date(booking.from).toISOString() : null,
          to: booking.to ? new Date(booking.to).toISOString() : null,
        })),
        locations: locations.map((location: LocationRow) => ({
          id: location.id,
          name: location.name,
          description: location.description || null,
          address: location.address || null,
          assetCount: location.assetCount || 0,
        })),
        teamMembers: teamMembers.map((member: TeamMemberRow) => ({
          id: member.id,
          name: member.name,
          email: member.userEmail || null,
          firstName: member.userFirstName || null,
          lastName: member.userLastName || null,
          userId: member.userId,
        })),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
