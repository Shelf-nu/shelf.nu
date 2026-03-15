import type { Asset, Custody, Kit, Location } from "@shelf/database";

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
  location: {
    select: {
      id: true,
      name: true,
    },
  },
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

type CustodyWithCustodian = Custody & {
  custodian: {
    name: string;
    user: {
      firstName: string;
      lastName: string;
      profilePicture: string | null;
    } | null;
  };
};

// Type exports for reuse
export type KitFromScanner = Kit & {
  location: Pick<Location, "id" | "name"> | null;
  _count: { assets: number };
  assets: Array<{
    id: string;
    status: string;
    availableToBook: boolean;
    custody: any;
  }>;
  custody: CustodyWithCustodian | null;
};

export type AssetFromScanner = Asset & {
  location: Pick<Location, "id" | "name"> | null;
  custody: CustodyWithCustodian | null;
};
