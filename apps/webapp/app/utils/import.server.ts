import type { CreateAssetFromContentImportPayload } from "~/modules/asset/types";
import { ShelfError } from "./error";
import { id } from "./id/id.server";

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
  const items = array.reduce(
    (acc, item) => {
      if (item[key] && item[key] !== "") {
        acc[item[key]] = "";
      }
      return acc;
    },
    {} as Record<string, string>
  );
  return items;
}

/** Takes the CSV data from a `content` import and parses it into an object that we can then use to create the entries */
export function extractCSVDataFromContentImport(
  data: string[][],
  csvHeaders: string[]
) {
  /**
   * The first row of the CSV contains the keys for the data
   * We need to trim the keys to remove any whitespace and special characters and Non-printable characters as it already causes issues with in the past
   * Non-printable character: The non-printable character you encountered at the beginning of the title property key ('\ufeff') is known as the Unicode BOM (Byte Order Mark).
   */
  const headers = data[0].map((key) => key.trim()); // Trim the keys
  const values = data.slice(1) as string[][];

  const csvData = values.map((entry) => {
    /**
     * Our csv file might contain duplicate data items, for example:
     * - Asset title can be duplicated
     *
     * In that case we need a way to identify each entry uniquely.
     * We will generate a unique id for each entry.
     * This will be used later to identify the entry when creating/updating assets.
     */
    const key = id(); // Generate a unique id for each entry

    const entryData = Object.fromEntries(
      entry.map((value, index) => {
        switch (headers[index]) {
          case "tags":
            return [headers[index], value.split(",").map((tag) => tag.trim())];
          case "imageUrl":
            // Return empty string if URL is empty/undefined, otherwise trim
            return [headers[index], value?.trim() || ""];
          case "bookable":
            return [headers[index], !value ? null : value];
          default:
            return [headers[index], value];
        }
      })
    );

    return {
      key,
      ...entryData,
    };
  });

  /* Validating headers in csv file */
  const defectedHeaders: Array<{
    incorrectHeader: string;
    errorMessage: string;
  }> = [];

  headers.forEach((header) => {
    if (header.startsWith("cf:")) {
      if (header.length < 4) {
        defectedHeaders.push({
          incorrectHeader: header,
          errorMessage: "Custom field header name is not provided.",
        });
      }

      return;
    } else if (!csvHeaders.includes(header)) {
      defectedHeaders.push({
        incorrectHeader: header,
        errorMessage: "Invalid header provided.",
      });
    }
  });

  if (defectedHeaders.length > 0) {
    throw new ShelfError({
      cause: null,
      message:
        "Invalid headers in csv file. Please fix the headers and try again.",
      additionalData: { defectedHeaders },
      label: "Assets",
      shouldBeCaptured: false,
    });
  }

  return csvData;
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
