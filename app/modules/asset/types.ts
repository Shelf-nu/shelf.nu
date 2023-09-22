import type { AssetCustomFieldValue } from "@prisma/client";

export interface ICustomFieldValueJson {
  raw: string | number | boolean,
  valueText?: string,
  valueBoolean?: boolean,
  valueDate?: string,
  valueOption?: string
  valueMultiLineText?: string
}

export type ShelfAssetCustomFieldValueType = Omit<AssetCustomFieldValue, "value"> & { value: ICustomFieldValueJson }