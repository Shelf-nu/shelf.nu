import type { Kit, Prisma } from "@prisma/client";

export type UpdateKitPayload = Partial<
  Pick<
    Kit,
    | "name"
    | "description"
    | "status"
    | "image"
    | "imageExpiration"
    | "createdById"
  >
> & {
  id: Kit["id"];
  organizationId: Kit["organizationId"];
};

// Define the static includes
export const GET_KIT_STATIC_INCLUDES = {
  custody: {
    select: {
      id: true,
      createdAt: true,
      agreement: true,
      signatureStatus: true,
      custodian: {
        select: {
          id: true,
          name: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
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
} satisfies Prisma.KitInclude;

export const KITS_INCLUDE_FIELDS = {
  _count: { select: { assets: true } },
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
  kitId: true,
  category: {
    select: {
      id: true,
      name: true,
      color: true,
    },
  },
  location: {
    select: {
      id: true,
      name: true,
    },
  },
  tags: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.AssetSelect;

/** Type used for the list item component */
export type ListItemForKitPage = Prisma.AssetGetPayload<{
  select: typeof KIT_SELECT_FIELDS_FOR_LIST_ITEMS;
}>;
