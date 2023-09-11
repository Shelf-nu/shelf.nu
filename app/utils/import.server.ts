import type { CustomField } from "@prisma/client";
import { db } from "~/database";
import type {
  CreateAssetFromBackupImportPayload,
  CreateAssetFromContentImportPayload,
} from "~/modules/asset";
import { createCustomField } from "~/modules/custom-field";

/* This function receives an array of object and a key name
 * It then extracts all the values of that key and makes sure there are no duplicates
 * 	as a last step it returns an object where the key is each unique value and the value is an empty string
 * The value will later be replaced by the id of the newly created item or the id of the existing item
 */
export function getUniqueValuesFromArrayOfObjects({
  array,
  key,
}: {
  array: Array<CreateAssetFromContentImportPayload>;
  key: string;
}) {
  const items = array.reduce((acc, item) => {
    if (item[key] && item[key] !== "") {
      acc[item[key]] = "";
    }
    return acc;
  }, {} as Record<string, string>);
  return items;
}

/** Takes the CSV data from a `content` import and parses it into an object that we can then use to create the entries */
export function extractCSVDataFromContentImport(data: string[][]) {
  const keys = data[0] as string[];
  const values = data.slice(1) as string[][];
  return values.map((entry) =>
    Object.fromEntries(
      entry.map((value, index) => {
        switch (keys[index]) {
          case "tags":
            return [keys[index], value.split(",").map((tag) => tag.trim())];
          default:
            return [keys[index], value];
        }
      })
    )
  );
}

/** Takes the CSV data from a `backup` import and parses it into an object that we can then use to create the entries */
export function extractCSVDataFromBackupImport(data: string[][]): any[] {
  const keys = data[0] as string[];
  const values = data.slice(1) as string[][];

  return values.map((entry) =>
    Object.fromEntries(
      entry
        .map((value, index) => {
          if (cellIsEmpty(value)) return undefined; // Return undefined for empty cells

          switch (keys[index]) {
            case "category":
            case "location":
            case "tags":
            case "notes":
            case "custody":
            case "customFields":
              return [keys[index], JSON.parse(value)];
            default:
              return [keys[index], value];
          }
        })
        .filter((entry): entry is [string, any] => entry !== undefined) // Remove undefined entries
    )
  );
}

/** Helper function that checks if cell is empty in the context of parsing the csv.
 * Empty cells can be:
 *  - empty string
 *  - undefined
 *  - "{}"
 *  - "[]"
 */
const cellIsEmpty = (cell: string) =>
  cell === "" || cell === undefined || cell === "{}" || cell === "[]";

export async function processCustomFields({
  asset,
  organizationId,
  userId,
}: {
  asset: CreateAssetFromBackupImportPayload;
  userId: string;
  organizationId: string;
}) {
  const cfIds: Record<CustomField["name"], CustomField["id"]> = {};

  for (const customFieldValue of asset.customFields) {
    const existingCustomField = await db.customField.findFirst({
      where: {
        name: customFieldValue.customField.name,
        organizationId,
      },
    });

    if (!existingCustomField) {
      const keysToExclude = [
        "id",
        "createdAt",
        "updatedAt",
        "userId",
        "organizationId",
      ];

      /** The reason we do it like this is because we dont want to worry about having to update the call to
       * createCustomFeild when a new attribute is added to the model
       * This approach will skip the keys which are not needed and just build the payload from the rest of the keys
       */
      const payloadObject = excludeKeys(
        customFieldValue.customField,
        keysToExclude
      );

      const newCustomField = await createCustomField({
        organizationId,
        userId,
        ...payloadObject,
      });
      cfIds[customFieldValue.customField.name] = newCustomField.id;
    } else {
      cfIds[customFieldValue.customField.name] = existingCustomField.id;
    }
  }
  return cfIds;
}

function excludeKeys(obj: any, keysToExclude: string[]) {
  const newObj = { ...obj };
  keysToExclude.forEach((key) => delete newObj[key]);
  return newObj;
}
