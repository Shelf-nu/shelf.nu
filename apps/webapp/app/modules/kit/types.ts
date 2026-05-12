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
  custody: {
    select: {
      quantity: true,
      // why: kit-page row needs to filter to kit-allocated rows only when
      // the parent kit is in custody, so it can show "kit holds N of M
      // units" instead of the asset's total stock.
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
