import type { Kit, KitStatus, Prisma } from "@prisma/client";
import type { AllowedCustodianFilterIds } from "~/modules/asset/utils.server";
import { applyCustodianAllowList } from "~/modules/asset/utils.server";

export function getKitsWhereInput({
  organizationId,
  currentSearchParams,
  allowedTeamMemberIds,
}: {
  organizationId: Kit["organizationId"];
  currentSearchParams?: string | null;
  /**
   * Required, with no default, so every call site states an answer. See the
   * twin parameter on `getAssetsWhereInput` — `?teamMember=` arrives on
   * `currentSearchParams` as raw request input, and a caller who may not see
   * all custody must not be able to filter a "select all" query by someone
   * else's id.
   */
  allowedTeamMemberIds: AllowedCustodianFilterIds;
}) {
  const where: Prisma.KitWhereInput = { organizationId };

  if (!currentSearchParams) {
    return where;
  }

  const searchParams = new URLSearchParams(currentSearchParams);

  const search = searchParams.get("s");
  const status =
    searchParams.get("status") === "ALL"
      ? null
      : (searchParams.get("status") as KitStatus);

  /**
   * `getAll`, because the custodian control is a multi-select: `DynamicDropdown`
   * defaults to `selectionMode: "append"` and seeds itself from `getAll`, so the
   * URL carries one value per chosen custodian. Reading only the first narrowed
   * the filter to one of them while the UI showed several as active.
   *
   * The allow-list is the shared one, so this answers the same way the assets
   * twin does: ids the viewer may not filter by are dropped, and a request that
   * asked ONLY for others collapses to an unmatchable id rather than to an empty
   * list, which would read as "no filter" and widen the query to every kit.
   */
  const teamMemberIds = applyCustodianAllowList(
    searchParams.getAll("teamMember"),
    allowedTeamMemberIds
  );

  // Same predicate as the kits index (`getPaginatedAndFilterableKits`): a
  // "select all" must act on exactly the kits the list shows, including those
  // found by a barcode value.
  if (search) {
    const searchTerm = search.toLowerCase().trim();
    where.OR = [
      { name: { contains: searchTerm, mode: "insensitive" } },
      {
        barcodes: {
          some: { value: { contains: searchTerm, mode: "insensitive" } },
        },
      },
    ];
  }

  if (status) {
    where.status = status;
  }

  if (teamMemberIds.length) {
    Object.assign(where, {
      custody: { custodianId: { in: teamMemberIds } },
    });
  }

  return where;
}

/**
 * Whether a storage path in the `kits` bucket is an image of `kitId`'s own.
 *
 * `updateKitImage` writes kit images to `<uploaderUserId>/<kitId>/<file>`, so
 * a kit's own image has exactly three non-empty segments with `kitId` in the
 * middle. Any other path names a file that belongs to a different kit, or to
 * a different workspace, and must never be signed for this kit or removed
 * with it. Callers check the same string they then sign or remove.
 *
 * @param path - A path from `extractStoragePath(url, "kits")`
 * @param kitId - The kit the image is stored on
 * @returns `true` only for a file directly inside the kit's own folder
 */
export function isOwnKitImagePath(path: string, kitId: Kit["id"]): boolean {
  const segments = path.split("/");
  return (
    segments.length === 3 &&
    segments[1] === kitId &&
    segments.every(
      (segment) => segment !== "" && segment !== "." && segment !== ".."
    )
  );
}
