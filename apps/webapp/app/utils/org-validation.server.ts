/**
 * Cross-Org Ownership Guards
 *
 * Shelf is multi-tenant: every domain entity (asset, tag, team member, …) is
 * scoped to an `organizationId`. Whenever a mutation links or reads entities by
 * an ID that originated from request/form input, the server MUST prove those
 * IDs belong to the caller's organization — otherwise an attacker in Org A can
 * supply Org B's IDs (cross-org IDOR).
 *
 * These guards centralize that check so every link/connect path uses the exact
 * same, tested logic instead of re-implementing (and occasionally forgetting)
 * the `where: { id: { in }, organizationId }` count-compare. They throw a 400
 * `ShelfError` on any mismatch — we deliberately do NOT silently drop foreign
 * IDs, because that hides attacks and corrupts the user's intended action.
 *
 * Each guard is transaction-aware: pass the active `tx` so the validation runs
 * in the same transaction as the mutation it protects (consistent with the
 * `recordEvent`-in-tx convention).
 *
 * @see {@link file://./../modules/booking/service.server.ts} updateBookingAssets — the original org-scoped pattern these guards generalize
 */

import type {
  Asset,
  Category,
  Location,
  Tag,
  TeamMember,
  User,
} from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

const label = "Request validation";

/**
 * Minimal Prisma surface these guards need. Both the extended top-level client
 * and an interactive transaction client satisfy this structurally, so callers
 * can pass either without type gymnastics (same approach as
 * `RecordEventTxClient`).
 */
export type OrgValidationTxClient = {
  asset: {
    findMany: (args: {
      where: { id: { in: string[] }; organizationId: string };
      select: { id: true };
    }) => Promise<{ id: string }[]>;
  };
  tag: {
    findMany: (args: {
      where: { id: { in: string[] }; organizationId: string };
      select: { id: true };
    }) => Promise<{ id: string }[]>;
  };
  teamMember: {
    findFirst: (args: {
      where: { id: string; organizationId: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
  category: {
    findFirst: (args: {
      where: { id: string; organizationId: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
  location: {
    findFirst: (args: {
      where: { id: string; organizationId: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
  userOrganization: {
    findFirst: (args: {
      where: { userId: string; organizationId: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
};

/**
 * Asserts that every asset ID belongs to `organizationId`.
 *
 * Dedupes the input first so duplicate IDs don't inflate the expected count
 * (findMany returns unique rows). A no-op for an empty list.
 *
 * @param params.assetIds - Asset IDs sourced from request/form input
 * @param params.organizationId - The caller's (validated) organization ID
 * @param tx - Optional Prisma transaction client; defaults to the global `db`
 * @throws {ShelfError} 400 if any ID is missing or belongs to another org
 */
export async function assertAssetsBelongToOrg(
  {
    assetIds,
    organizationId,
  }: { assetIds: Asset["id"][]; organizationId: string },
  tx?: OrgValidationTxClient
): Promise<void> {
  if (assetIds.length === 0) return;

  const client = tx ?? db;
  const uniqueIds = [...new Set(assetIds)];

  const found = await client.asset.findMany({
    where: { id: { in: uniqueIds }, organizationId },
    select: { id: true },
  });

  if (found.length !== uniqueIds.length) {
    throw new ShelfError({
      cause: null,
      title: "Invalid assets",
      message:
        "Some of the selected assets do not exist in your workspace. Please reload and try again.",
      label,
      status: 400,
      shouldBeCaptured: false,
      additionalData: { organizationId },
    });
  }
}

/**
 * Asserts that every tag ID belongs to `organizationId`.
 *
 * @param params.tagIds - Tag IDs sourced from request/form input
 * @param params.organizationId - The caller's (validated) organization ID
 * @param tx - Optional Prisma transaction client; defaults to the global `db`
 * @throws {ShelfError} 400 if any ID is missing or belongs to another org
 */
export async function assertTagsBelongToOrg(
  { tagIds, organizationId }: { tagIds: Tag["id"][]; organizationId: string },
  tx?: OrgValidationTxClient
): Promise<void> {
  if (tagIds.length === 0) return;

  const client = tx ?? db;
  const uniqueIds = [...new Set(tagIds)];

  const found = await client.tag.findMany({
    where: { id: { in: uniqueIds }, organizationId },
    select: { id: true },
  });

  if (found.length !== uniqueIds.length) {
    throw new ShelfError({
      cause: null,
      title: "Invalid tags",
      message:
        "Some of the selected tags do not exist in your workspace. Please reload and try again.",
      label,
      status: 400,
      shouldBeCaptured: false,
      additionalData: { organizationId },
    });
  }
}

/**
 * Asserts that a single team member belongs to `organizationId`.
 *
 * @param params.teamMemberId - Team member ID sourced from request/form input
 * @param params.organizationId - The caller's (validated) organization ID
 * @param tx - Optional Prisma transaction client; defaults to the global `db`
 * @throws {ShelfError} 404 if the team member is missing or in another org
 */
export async function assertTeamMemberBelongsToOrg(
  {
    teamMemberId,
    organizationId,
  }: { teamMemberId: TeamMember["id"]; organizationId: string },
  tx?: OrgValidationTxClient
): Promise<void> {
  const client = tx ?? db;

  const found = await client.teamMember.findFirst({
    where: { id: teamMemberId, organizationId },
    select: { id: true },
  });

  if (!found) {
    throw new ShelfError({
      cause: null,
      title: "Team member not found",
      message: "The selected team member could not be found in your workspace.",
      label,
      status: 404,
      shouldBeCaptured: false,
      additionalData: { organizationId, teamMemberId },
    });
  }
}

/**
 * Asserts that a single category belongs to `organizationId`.
 *
 * @param params.categoryId - Category ID sourced from request/form input
 * @param params.organizationId - The caller's (validated) organization ID
 * @param tx - Optional Prisma transaction client; defaults to the global `db`
 * @throws {ShelfError} 404 if the category is missing or in another org
 */
export async function assertCategoryBelongsToOrg(
  {
    categoryId,
    organizationId,
  }: { categoryId: Category["id"]; organizationId: string },
  tx?: OrgValidationTxClient
): Promise<void> {
  const client = tx ?? db;

  const found = await client.category.findFirst({
    where: { id: categoryId, organizationId },
    select: { id: true },
  });

  if (!found) {
    throw new ShelfError({
      cause: null,
      title: "Invalid category",
      message:
        "The selected category could not be found in your workspace. Please reload and try again.",
      label,
      status: 404,
      shouldBeCaptured: false,
      additionalData: { organizationId, categoryId },
    });
  }
}

/**
 * Asserts that a single location belongs to `organizationId`.
 *
 * @param params.locationId - Location ID sourced from request/form input
 * @param params.organizationId - The caller's (validated) organization ID
 * @param tx - Optional Prisma transaction client; defaults to the global `db`
 * @throws {ShelfError} 404 if the location is missing or in another org
 */
export async function assertLocationBelongsToOrg(
  {
    locationId,
    organizationId,
  }: { locationId: Location["id"]; organizationId: string },
  tx?: OrgValidationTxClient
): Promise<void> {
  const client = tx ?? db;

  const found = await client.location.findFirst({
    where: { id: locationId, organizationId },
    select: { id: true },
  });

  if (!found) {
    throw new ShelfError({
      cause: null,
      title: "Invalid location",
      message:
        "The selected location could not be found in your workspace. Please reload and try again.",
      label,
      status: 404,
      shouldBeCaptured: false,
      additionalData: { organizationId, locationId },
    });
  }
}

/**
 * Asserts that a user is a member of `organizationId` (via UserOrganization).
 *
 * Used to validate request-supplied custodian *user* IDs before connecting
 * them to a booking — `custodianTeamMemberId` being org-valid does not prove
 * the paired `custodianUserId` is, so an attacker could otherwise bind an
 * arbitrary (foreign) user as the custodian user and leak their name/email.
 *
 * @param params.userId - User ID sourced from request/form input
 * @param params.organizationId - The caller's (validated) organization ID
 * @param tx - Optional Prisma transaction client; defaults to the global `db`
 * @throws {ShelfError} 404 if the user is not a member of the organization
 */
export async function assertUserBelongsToOrg(
  { userId, organizationId }: { userId: User["id"]; organizationId: string },
  tx?: OrgValidationTxClient
): Promise<void> {
  const client = tx ?? db;

  const found = await client.userOrganization.findFirst({
    where: { userId, organizationId },
    select: { id: true },
  });

  if (!found) {
    throw new ShelfError({
      cause: null,
      title: "Invalid custodian",
      message:
        "The selected custodian user is not a member of this workspace. Please reload and try again.",
      label,
      status: 404,
      shouldBeCaptured: false,
      additionalData: { organizationId, userId },
    });
  }
}
