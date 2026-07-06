import type { RenderableTreeNode } from "@markdoc/markdoc";
import type {
  Asset,
  AssetCustomFieldValue,
  Location,
  Category,
  CustomField,
  Kit,
  Prisma,
  Tag,
  User,
  CustomFieldType,
  AssetReminder,
  Organization,
  Booking,
  BarcodeType,
  Barcode,
  TeamMember,
} from "@prisma/client";
import type { Return } from "@prisma/client/runtime/library";
import type { assetIndexFields } from "./fields";

export interface ICustomFieldValueJson {
  raw: string | number | boolean;
  valueText?: string;
  valueBoolean?: boolean;
  valueDate?: string;
  valueOption?: string;
  valueMultiLineText?: RenderableTreeNode;
}

export type ShelfAssetCustomFieldValueType = Omit<
  AssetCustomFieldValue,
  "value"
> & { value: ICustomFieldValueJson };

export interface UpdateAssetPayload {
  id: Asset["id"];
  title?: Asset["title"];
  description?: Asset["description"];
  /** Pass 'uncategorized' to clear the category */
  categoryId?: Asset["categoryId"];
  /** Pass null to clear the asset model association */
  assetModelId?: string | null;
  // `Asset.locationId` no longer exists (location lives on the
  // `AssetLocation` pivot). These carry the single primary-location id
  // through the update flow.
  newLocationId?: string | null;
  currentLocationId?: string | null;
  /**
   * Per-asset single-location qty for QUANTITY_TRACKED placements via
   * the asset-overview update-location dialog. When provided alongside
   * `newLocationId`, the new pivot row uses this value (subject to the
   * orthogonal-MAX re-validation in `updateAsset`). Falls back to
   * `Asset.quantity` (full pool) when omitted — preserves back-compat
   * for paths that don't expose a qty input yet (bulk + scan + mobile).
   */
  newLocationQuantity?: number;
  mainImage?: Asset["mainImage"];
  thumbnailImage?: string | null;
  mainImageExpiration?: Asset["mainImageExpiration"];
  tags?: { set: { id: string }[] };
  userId: User["id"];
  customFieldsValues?: ShelfAssetCustomFieldValueType[];
  barcodes?: { id?: string; type: BarcodeType; value: string }[];
  /**
   * Per-asset override of the displayed identifier in list views.
   * - `undefined` → leave the column unchanged
   * - `null` or `""` → clear the override (follow workspace default)
   * - a string → set to that specific Barcode.id (validated to belong to this asset)
   */
  preferredBarcodeId?: Asset["preferredBarcodeId"] | undefined;
  valuation?: Asset["valuation"];
  organizationId: Organization["id"];
  request: Request;
  quantity?: Asset["quantity"];
  minQuantity?: Asset["minQuantity"];
  consumptionType?: Asset["consumptionType"];
  unitOfMeasure?: Asset["unitOfMeasure"];
}

export interface CreateAssetFromContentImportPayload
  extends Record<string, any> {
  key: string; // Unique identifier for the asset in the import (this is generated while parsing the csv file)
  title: string;
  description?: string;
  category?: string;
  kit?: string;
  tags?: string[];
  location?: string;
  custodian?: string;
  bookable?: "yes" | "no";
  imageUrl?: string; // URL of the image to import
  /** AssetModel reference by name (case-insensitive). Resolved /
   * upserted via createAssetModelsIfNotExists during import. */
  assetModel?: string;
  /** AssetType — defaults to INDIVIDUAL when omitted */
  type?: "INDIVIDUAL" | "QUANTITY_TRACKED";
  /** Required (>0) for QUANTITY_TRACKED; defaults to 1 for INDIVIDUAL */
  quantity?: string;
  /** Optional low-stock threshold for QUANTITY_TRACKED */
  minQuantity?: string;
  /** Free-form text label ("boxes", "kg", …) for QUANTITY_TRACKED */
  unitOfMeasure?: string;
  /** Required for QUANTITY_TRACKED. ONE_WAY (consumed on checkout) or
   * TWO_WAY (returned with consumption report). */
  consumptionType?: "ONE_WAY" | "TWO_WAY";
}

export interface CreateAssetFromBackupImportPayload
  extends Record<string, any> {
  id: string;
  title: string;
  description?: string;
  category:
    | {
        id: string;
        name: string;
        description: string;
        color: string;
        createdAt: string;
        updatedAt: string;
        userId: string;
      }
    | {};
  tags: {
    name: string;
  }[];
  location:
    | {
        name: string;
        description?: string;
        address?: string;
        createdAt: string;
        updatedAt: string;
      }
    | {};
  customFields: AssetCustomFieldsValuesWithFields[];
}

export type AssetCustomFieldsValuesWithFields =
  ShelfAssetCustomFieldValueType & {
    customField: CustomField;
  };

/** Item returned by getAssetsFromView */
export type AssetsFromViewItem = Prisma.AssetGetPayload<{
  include: Return<typeof assetIndexFields>;
}>;

/** Type for advanced asset booking */
export type AdvancedAssetBooking = Pick<
  Booking,
  "id" | "name" | "status" | "description"
> & {
  from: string;
  to: string;
  tags: Array<Pick<Tag, "id" | "name" | "color">>;
  custodianTeamMember?: Pick<TeamMember, "id" | "name">;
  custodianUser?: Pick<
    User,
    "id" | "firstName" | "lastName" | "profilePicture"
  >;
  creator?: Pick<User, "id" | "firstName" | "lastName" | "profilePicture">;
  /** BookingAsset.assetKitId of THIS slice: null = standalone (free pool),
   * non-null = kit-driven (FK → AssetKit.id). Availability view only. */
  assetKitId?: string | null;
  /** BookingAsset.quantity — booked units for THIS slice. Never Asset.quantity
   * (workspace stock). Availability view only. */
  quantity?: number;
  /** Kit name for THIS slice (null when standalone), resolved via
   * AssetKit → Kit.name. Availability view only. */
  kitName?: string | null;
};

/** Type for advanced index query. We cannot infer it because we do a raw query so we need to create it ourselves. */
export type AdvancedIndexAsset = Pick<
  Asset,
  | "id"
  | "sequentialId"
  | "title"
  | "description"
  | "createdAt"
  | "updatedAt"
  | "userId"
  | "mainImage"
  | "thumbnailImage"
  | "mainImageExpiration"
  | "categoryId"
  | "organizationId"
  | "status"
  | "type"
  | "valuation"
  | "quantity"
  | "unitOfMeasure"
  | "availableToBook"
> & {
  qrId: string; // QR code will always be available
  assetModelId?: string | null;
  assetModelName?: string | null;
  /** Primary kit (oldest pivot row) — mirrors the LATERAL primary-pick
   * used by ORDER BY and filters. Kept alongside `kits` for back-compat
   * with consumers that only need the primary. */
  kit: Pick<Kit, "id" | "name"> | null;
  /** Full kit membership for the asset, ordered by `AssetKit.createdAt`.
   * A multi-kit QUANTITY_TRACKED asset surfaces all kits here so the
   * asset-index "Kit" column can render the primary plus a "+N more"
   * affordance (mirror of `custody`). Always an array, never null. */
  kits: Array<Pick<Kit, "id" | "name" | "status">>;
  category: Pick<Category, "id" | "name" | "color"> | null;
  tags: Pick<Tag, "id" | "name" | "color">[];
  /** Primary placement (oldest pivot row) — see `kit` above. */
  location:
    | (Pick<Location, "id" | "name"> & {
        parentId?: Location["parentId"];
        childCount?: number;
      })
    | null;
  /** Full placement list for the asset, ordered by
   * `AssetLocation.createdAt`. Mirror of `kits`. Always an array. */
  locations: Array<
    Pick<Location, "id" | "name"> & {
      parentId?: Location["parentId"];
      childCount?: number;
    }
  >;
  custody:
    | {
        /** Custodian display name; mirrored at the top level so callers
         * can read it without descending into `custodian`. */
        name?: string;
        /** Per-custody quantity; meaningful for QUANTITY_TRACKED assets
         * where the same asset can be split across multiple custodians.
         * Optional because the booking-derived synthetic custody case
         * does not project a quantity. */
        quantity?: number;
        custodian: {
          name: string;
          user: {
            id: string;
            firstName: string | null;
            lastName: string | null;
            profilePicture: string | null;
            email: string;
          } | null;
        };
      }[]
    | null;
  customFields: (AssetCustomFieldValue & {
    customField: Pick<
      CustomField,
      "id" | "name" | "helpText" | "required" | "type" | "options"
    > & {
      categories: Pick<Category, "id" | "name">[] | null;
    };
  })[];
  upcomingReminder?: Pick<
    AssetReminder,
    "id" | "alertDateTime" | "name" | "message"
  >;
  bookings?: Array<AdvancedAssetBooking>;
  barcodes?: Array<Pick<Barcode, "id" | "type" | "value">>;
};
// Type for the entire query result
export type AdvancedIndexQueryResult = Array<{
  total_count: number;
  assets: AdvancedIndexAsset[]; // This is now guaranteed to be an array, never null
}>;

export interface CustomFieldSorting {
  name: string;
  valueKey: string;
  alias: string;
  fieldType?: CustomFieldType;
}
