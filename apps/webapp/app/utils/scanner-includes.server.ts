import type { Prisma } from "@prisma/client";

import type { AssetImageSource } from "~/modules/asset/image-resolution";
import { ASSET_MODEL_IMAGE_SELECT } from "~/modules/asset/image-select";

/**
 * The custodian fields every scanner row renders a holder with.
 *
 * Shared by the asset and kit custody selections below, which select it off
 * two different relations.
 */
const CUSTODIAN_SELECT = {
  name: true,
  user: {
    select: {
      firstName: true,
      lastName: true,
      displayName: true,
      profilePicture: true,
    },
  },
} satisfies Prisma.TeamMemberSelect;

/**
 * Custody selection for a scanned ASSET.
 *
 * `Asset.custody` is a list of `Custody` rows — one per holder — each carrying
 * the units that holder has.
 */
export const ASSET_CUSTODY_INCLUDE = {
  custody: {
    select: {
      // Units this row holds. The release scanner bounds its quantity input by
      // the operator-assigned rows — see `kitCustodyId` below.
      quantity: true,
      // Which axis this row belongs to: null is operator-assigned, non-null
      // means the row was inherited from the kit's custody and cascades with
      // it. Only the operator axis can be handed back asset-by-asset, so the
      // release scanner needs to tell them apart before offering a ceiling.
      kitCustodyId: true,
      custodian: { select: CUSTODIAN_SELECT },
    },
  },
} satisfies Prisma.AssetInclude;

/**
 * Custody selection for a scanned KIT.
 *
 * `Kit.custody` is a single `KitCustody` row. Despite the matching field name
 * it is a different model from the asset-side `Custody`: it records who holds
 * the kit and carries no `quantity`, because units live on the `Custody` rows
 * it cascades to. So the two selections above and below cannot be merged into
 * one shared constant, however alike they look — and a field only `Custody`
 * has must never be added here.
 *
 * Getting that wrong takes down far more than kit scans: both scanned-item
 * endpoints resolve the asset and kit branches in a SINGLE query, so an
 * invalid kit selection fails every lookup, for every code. `getQr` reports
 * the Prisma error as "This code doesn't exist or it doesn't belong to your
 * current organization", which reads as a workspace problem and sends you
 * looking in the wrong place. The `satisfies` clause is what keeps this a
 * build error instead: it only checks a literal written here, so keep the
 * shape inline rather than spreading it in from elsewhere.
 */
export const KIT_CUSTODY_INCLUDE = {
  custody: {
    select: {
      custodian: { select: CUSTODIAN_SELECT },
    },
  },
} satisfies Prisma.KitInclude;

/**
 * Scanner-facing Asset include.
 *
 * Uses Prisma `include` (no top-level `select`) so all Asset scalar
 * columns ship by default. Scanner drawers — notably
 * `partial-checkout-drawer`'s `isCheckoutEligibleAsset` filter and
 * `AssetRow` — depend on `status` and `type` being present on every
 * asset payload returned by `/api/get-scanned-item/$qrId` and
 * `/api/get-scanned-item-by-barcode`. Do not narrow this to `select`
 * without re-adding `status` and `type` explicitly.
 */
export const ASSET_INCLUDE = {
  // Model cover image — the scanned-item endpoints collapse the cascade
  // into flat `mainImage`/`thumbnailImage` via `serializeAssetImage`, so
  // assets with no image of their own render their model's cover in every
  // scanner drawer.
  ...ASSET_MODEL_IMAGE_SELECT,
  // Asset placement lives on the `AssetLocation` pivot. Consumers read
  // the primary placement via `getPrimaryLocation`.
  assetLocations: {
    select: {
      location: { select: { id: true, name: true } },
    },
  },
  assetKits: {
    select: {
      kitId: true,
      kit: { select: { id: true, name: true } },
    },
  },
  ...ASSET_CUSTODY_INCLUDE,
};

export const KIT_INCLUDE = {
  location: {
    select: {
      id: true,
      name: true,
    },
  },
  _count: { select: { assetKits: true } },
  assetKits: {
    select: {
      // Scanner needs the AssetKit's own id so kit-driven
      // BookingAsset rows can be created with `assetKitId` set when
      // the user scans a kit's QR. Without this, the booking UI
      // can't tell which kit a row came from.
      id: true,
      // The kit's slice of this asset — how many units the kit holds, which
      // is what a kit-driven `BookingAsset` row is worth. Read by the
      // booking drawers when a scanned kit becomes rows on the booking.
      quantity: true,
      asset: {
        select: {
          id: true,
          status: true,
          // `type` lets scanner callers branch INDIVIDUAL vs QUANTITY_TRACKED
          // (e.g. partial-checkout eligibility — QT supports top-off via the
          // remaining-units map, INDIVIDUAL is binary).
          type: true,
          availableToBook: true,
          custody: true,
          // Which `AssetModel` the member is an instance of. The fulfil
          // drawer matches a kit's members against the booking's
          // outstanding `BookingModelRequest`s on this id, so a kit scan
          // discharges reserved units the same way a loose scan does.
          assetModelId: true,
        },
      },
    },
  },
  ...KIT_CUSTODY_INCLUDE,
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

/**
 * Ambient picker meta the scanner API attaches when a destination
 * context (location / kit / booking) is provided in the query string.
 * Kept here as an optional field instead of a Prisma include so it
 * survives the `Prisma.AssetGetPayload<>` type derivation without
 * forcing every consumer to know about it. Always `null` for
 * INDIVIDUAL assets and for calls without `pickerContext`.
 *
 * @see {@link file://./../modules/scanner/picker-meta.server.ts} ScannerPickerMeta
 */
export type ScannerAssetPickerMeta = {
  maxAllowed: number;
  assetQuantity: number;
  unitOfMeasure: string | null;
} | null;

/**
 * An asset as the scanned-item endpoints RESPOND with it — not as Prisma
 * returns it. The endpoints collapse the model-image cascade via
 * `serializeAssetImage`, which drops the `assetModel` relation and adds
 * `imageSource`, so this type mirrors that serialized shape.
 */
export type AssetFromScanner = Omit<
  Prisma.AssetGetPayload<{
    include: typeof ASSET_INCLUDE;
  }>,
  "assetModel"
> & {
  mainImage: string | null;
  thumbnailImage: string | null;
  imageSource: AssetImageSource;
  pickerMeta?: ScannerAssetPickerMeta;
};
