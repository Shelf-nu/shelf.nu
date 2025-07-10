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
  newLocationId?: Asset["locationId"];
  currentLocationId?: Asset["locationId"];
  mainImage?: Asset["mainImage"];
  thumbnailImage?: string | null;
  mainImageExpiration?: Asset["mainImageExpiration"];
  tags?: { set: { id: string }[] };
  userId: User["id"];
  customFieldsValues?: ShelfAssetCustomFieldValueType[];
  barcodes?: { id?: string; type: BarcodeType; value: string }[];
  valuation?: Asset["valuation"];
  organizationId: Organization["id"];
}

export interface CreateAssetFromContentImportPayload
  extends Record<string, any> {
  key: string; // Unique identifier for the asset in the import (this is generated while parsing the csv file)
  title: string;
  description?: string;
  category?: string;
  kit?: string;
  tags: string[];
  location?: string;
  custodian?: string;
  bookable?: "yes" | "no";
  imageUrl?: string; // URL of the image to import
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

/** Type for advanced index query. We cannot infer it because we do a raw query so we need to create it ourselves. */
export type AdvancedIndexAsset = Pick<
  Asset,
  | "id"
  | "title"
  | "description"
  | "createdAt"
  | "updatedAt"
  | "userId"
  | "mainImage"
  | "thumbnailImage"
  | "mainImageExpiration"
  | "categoryId"
  | "locationId"
  | "organizationId"
  | "status"
  | "valuation"
  | "availableToBook"
  | "kitId"
> & {
  qrId: string; // QR code will always be available
  kit: Pick<Kit, "id" | "name"> | null;
  category: Pick<Category, "id" | "name" | "color"> | null;
  tags: Pick<Tag, "id" | "name">[];
  location: Pick<Location, "name"> | null;
  custody: {
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
  } | null;
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
  > & {
    displayDate: string;
  };
  bookings?: Array<
    Pick<Booking, "id" | "name" | "from" | "to" | "status" | "description">
  >;
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
