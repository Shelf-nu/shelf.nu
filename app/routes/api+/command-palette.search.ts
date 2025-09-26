import { Prisma } from "@prisma/client";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";

import { db } from "~/database/db.server";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
});

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
      return json(
        data({
          query,
          assets: [],
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

    // Helper function to create search conditions for text fields
    const createTextSearchConditions = (term: string, fields: string[]) =>
      fields.map((field) => ({
        [field]: { contains: term, mode: Prisma.QueryMode.insensitive },
      }));

    // Asset search conditions
    const assetSearchConditions: Prisma.AssetWhereInput[] = searchTerms.map(
      (term) => ({
        OR: [
          {
            title: { contains: term, mode: Prisma.QueryMode.insensitive },
          },
          {
            sequentialId: {
              contains: term,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            id: { contains: term, mode: Prisma.QueryMode.insensitive },
          },
          {
            description: {
              contains: term,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            location: {
              name: { contains: term, mode: Prisma.QueryMode.insensitive },
            },
          },
          {
            qrCodes: {
              some: {
                id: { contains: term, mode: Prisma.QueryMode.insensitive },
              },
            },
          },
          {
            barcodes: {
              some: {
                value: { contains: term, mode: Prisma.QueryMode.insensitive },
              },
            },
          },
          {
            customFields: {
              some: {
                value: {
                  path: ["valueText"],
                  string_contains: term,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            },
          },
        ],
      })
    );

    // Kit search conditions
    const kitSearchConditions: Prisma.KitWhereInput[] = searchTerms.map(
      (term) => ({
        OR: [
          ...createTextSearchConditions(term, ["name", "description"]),
          { id: { contains: term, mode: Prisma.QueryMode.insensitive } },
        ],
      })
    );

    // Booking search conditions
    const bookingSearchConditions: Prisma.BookingWhereInput[] = searchTerms.map(
      (term) => ({
        OR: [
          ...createTextSearchConditions(term, ["name", "description"]),
          { id: { contains: term, mode: Prisma.QueryMode.insensitive } },
        ],
      })
    );

    // Location search conditions
    const locationSearchConditions: Prisma.LocationWhereInput[] =
      searchTerms.map((term) => ({
        OR: [
          ...createTextSearchConditions(term, [
            "name",
            "description",
            "address",
          ]),
          { id: { contains: term, mode: Prisma.QueryMode.insensitive } },
        ],
      }));

    // Team member search conditions
    const teamMemberSearchConditions: Prisma.TeamMemberWhereInput[] =
      searchTerms.map((term) => ({
        OR: [
          { name: { contains: term, mode: Prisma.QueryMode.insensitive } },
          { id: { contains: term, mode: Prisma.QueryMode.insensitive } },
          {
            user: {
              OR: [
                {
                  firstName: {
                    contains: term,
                    mode: Prisma.QueryMode.insensitive,
                  },
                },
                {
                  lastName: {
                    contains: term,
                    mode: Prisma.QueryMode.insensitive,
                  },
                },
                {
                  email: {
                    contains: term,
                    mode: Prisma.QueryMode.insensitive,
                  },
                },
              ],
            },
          },
        ],
      }));

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

    // Prepare where clauses
    const assetWhere: Prisma.AssetWhereInput = {
      organizationId,
      ...(assetSearchConditions.length ? { OR: assetSearchConditions } : {}),
    };

    const kitWhere: Prisma.KitWhereInput = {
      organizationId,
      ...(kitSearchConditions.length ? { OR: kitSearchConditions } : {}),
    };

    const bookingWhere: Prisma.BookingWhereInput = {
      organizationId,
      ...(bookingSearchConditions.length
        ? { OR: bookingSearchConditions }
        : {}),
      // BASE and SELF_SERVICE users can only see their own bookings unless org settings allow otherwise
      ...(canSeeAllBookings ? {} : { custodianUserId: userId }),
    };

    const locationWhere: Prisma.LocationWhereInput = {
      organizationId,
      ...(locationSearchConditions.length
        ? { OR: locationSearchConditions }
        : {}),
    };

    const teamMemberWhere: Prisma.TeamMemberWhereInput = {
      organizationId,
      deletedAt: null,
      ...(teamMemberSearchConditions.length
        ? { OR: teamMemberSearchConditions }
        : {}),
      // BASE and SELF_SERVICE users can only see team members they have custody access to
      ...(canSeeAllCustody
        ? {}
        : {
            OR: [
              // Team members they have assets in custody from
              {
                custodies: {
                  some: {
                    custodian: { userId },
                  },
                },
              },
              // Team members they have kits in custody from
              {
                kitCustodies: {
                  some: {
                    custodian: { userId },
                  },
                },
              },
              // Their own team member record
              { userId },
            ],
          }),
    };

    // Execute parallel searches
    const [assets, kits, bookings, locations, teamMembers] = await Promise.all([
      // Assets (always allowed)
      db.asset.findMany({
        where: assetWhere,
        take: 8,
        orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
        include: {
          location: { select: { name: true } },
        },
      }),

      // Kits (permission-gated)
      hasKitPermission
        ? db.kit.findMany({
            where: kitWhere,
            take: 6,
            orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
            include: {
              _count: { select: { assets: true } },
            },
          })
        : Promise.resolve([]),

      // Bookings (permission-gated)
      hasBookingPermission
        ? db.booking.findMany({
            where: bookingWhere,
            take: 6,
            orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
            include: {
              custodianUser: {
                select: { firstName: true, lastName: true, email: true },
              },
              custodianTeamMember: { select: { name: true } },
            },
          })
        : Promise.resolve([]),

      // Locations (permission-gated)
      hasLocationPermission
        ? db.location.findMany({
            where: locationWhere,
            take: 6,
            orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
            include: {
              _count: { select: { assets: true } },
            },
          })
        : Promise.resolve([]),

      // Team members (permission-gated)
      hasTeamMemberPermission
        ? db.teamMember.findMany({
            where: teamMemberWhere,
            take: 8,
            orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    return json(
      data({
        query,
        assets: assets.map((asset) => ({
          id: asset.id,
          title: asset.title,
          sequentialId: asset.sequentialId,
          mainImage: asset.mainImage,
          mainImageExpiration: asset.mainImageExpiration?.toISOString() ?? null,
          locationName: asset.location?.name ?? null,
        })),
        kits: kits.map((kit) => ({
          id: kit.id,
          name: kit.name,
          description: kit.description || null,
          status: kit.status,
          assetCount: kit._count?.assets || 0,
        })),
        bookings: bookings.map((booking) => ({
          id: booking.id,
          name: booking.name,
          description: booking.description || null,
          status: booking.status,
          custodianName: booking.custodianUser
            ? `${booking.custodianUser.firstName} ${booking.custodianUser.lastName}`.trim()
            : booking.custodianTeamMember?.name || null,
          from: booking.from?.toISOString() || null,
          to: booking.to?.toISOString() || null,
        })),
        locations: locations.map((location) => ({
          id: location.id,
          name: location.name,
          description: location.description || null,
          address: location.address || null,
          assetCount: location._count?.assets || 0,
        })),
        teamMembers: teamMembers.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.user?.email || null,
          firstName: member.user?.firstName || null,
          lastName: member.user?.lastName || null,
        })),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
