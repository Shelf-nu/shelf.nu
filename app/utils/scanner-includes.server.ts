import type { Prisma } from "@prisma/client";

export const CUSTODY_INCLUDE = {
  custody: {
    select: {
      custodian: {
        select: {
          name: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              profilePicture: true,
            },
          },
        },
      },
    },
  },
};

export const ASSET_INCLUDE = {
  location: {
    select: {
      id: true,
      name: true,
    },
  },
  ...CUSTODY_INCLUDE,
};

export const KIT_INCLUDE = {
  _count: { select: { assets: true } },
  assets: {
    select: {
      id: true,
      status: true,
      availableToBook: true,
      custody: true,
    },
  },
  ...CUSTODY_INCLUDE,
};

export const QR_INCLUDE = {
  asset: {
    include: ASSET_INCLUDE,
  },
  kit: {
    include: KIT_INCLUDE,
  },
};

export const BARCODE_INCLUDE = {
  asset: {
    include: ASSET_INCLUDE,
  },
  kit: {
    include: KIT_INCLUDE,
  },
};

// Type exports for reuse
export type KitFromScanner = Prisma.KitGetPayload<{
  include: typeof KIT_INCLUDE;
}>;

export type AssetFromScanner = Prisma.AssetGetPayload<{
  include: typeof ASSET_INCLUDE;
}>;
