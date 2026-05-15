import type { Kit, Prisma, Barcode } from "@prisma/client";
import { TAG_WITH_COLOR_SELECT } from "~/modules/tag/constants";
import { LOCATION_WITH_HIERARCHY } from "../asset/fields";

export type UpdateKitPayload = Partial<
  Pick<
    Kit,
    | "name"
    | "description"
    | "status"
    | "image"
    | "imageExpiration"
    | "categoryId"
    | "locationId"
  >
> & {
  id: Kit["id"];
  organizationId: Kit["organizationId"];
  createdById: Kit["createdById"];
  barcodes?: (Pick<Barcode, "type" | "value"> & { id?: string })[];
};

// Define the static includes
export const GET_KIT_STATIC_INCLUDES = {
  location: LOCATION_WITH_HIERARCHY,
  custody: {
    select: {
      id: true,
      createdAt: true,
      custodian: {
        select: {
          id: true,
          name: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
              profilePicture: true,
              email: true,
            },
          },
        },
      },
    },
  },
  organization: {
    select: { currency: true },
  },
};

export const KITS_INCLUDE_FIELDS = {
  // The count semantics are identical (rows per kit) since today's
  // unique constraint on `AssetKit.assetId` keeps it 1:1.
  _count: { select: { assetKits: true } },
  custody: {
    select: {
      custodian: {
        select: {
          userId: true,
          name: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
              profilePicture: true,
              email: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.KitInclude;

/** Select used on the kit page for fetching the assets with minimal data */
export const KIT_SELECT_FIELDS_FOR_LIST_ITEMS = {
  id: true,
  title: true,
  mainImage: true,
  thumbnailImage: true,
  mainImageExpiration: true,
  status: true,
  availableToBook: true,
  type: true,
  quantity: true,
  unitOfMeasure: true,
  // why: Phase 4a-Polish-2 makes `AssetKit.quantity` the source of truth
  // for "how many units this kit holds". The kit-page row reads the
  // matching pivot row (filter by this route's kitId client-side) and
  // renders `N / total units in kit`. Before Polish-2 the count was
  // derived from `asset.quantity − operator custody`, which is now wrong
  // once the kit can hold a strict subset of the pool.
  assetKits: {
    select: { kitId: true, quantity: true },
  },
  custody: {
    select: {
      quantity: true,
      kitCustodyId: true,
    },
  },
  category: {
    select: {
      id: true,
      name: true,
      color: true,
    },
  },
  location: LOCATION_WITH_HIERARCHY,
  tags: TAG_WITH_COLOR_SELECT,
};

/** Type used for the list item component */
export type ListItemForKitPage = Prisma.AssetGetPayload<{
  select: typeof KIT_SELECT_FIELDS_FOR_LIST_ITEMS;
}>;
