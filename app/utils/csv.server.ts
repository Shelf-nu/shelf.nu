import {
  CustomFieldType,
  type Asset,
  type AssetIndexSettings,
} from "@prisma/client";
import {
  unstable_composeUploadHandlers,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import chardet from "chardet";
import { CsvError, parse } from "csv-parse";
import { format } from "date-fns";
import iconv from "iconv-lite";
import {
  fetchAssetsForExport,
  getAdvancedPaginatedAndFilterableAssets,
} from "~/modules/asset/service.server";
import type {
  AdvancedIndexAsset,
  ShelfAssetCustomFieldValueType,
} from "~/modules/asset/types";
import type {
  Column,
  FixedField,
} from "~/modules/asset-index-settings/helpers";
import { parseColumnName } from "~/modules/asset-index-settings/helpers";
import { checkExhaustiveSwitch } from "./check-exhaustive-switch";
import { getAdvancedFiltersFromRequest } from "./cookies.server";
import { isLikeShelfError, ShelfError } from "./error";
import { ALL_SELECTED_KEY } from "./list";
import { resolveTeamMemberName } from "./user";

export type CSVData = [string[], ...string[][]] | [];

/** Guesses the delimiter of csv based on the most common delimiter found in the file */
function guessDelimiters(csv: string, delimiters: string[]) {
  const delimiterCounts = delimiters.map(
    (delimiter) => csv.split(delimiter).length
  );

  const max = Math.max(...delimiterCounts);

  const delimiter = delimiters[delimiterCounts.indexOf(max)];
  return delimiter;
}

/** Parses csv Data into an array with type {@link CSVData} */
export const parseCsv = (csvData: ArrayBuffer) => {
  const results = [] as CSVData;
  /** Detect the file encoding */
  const encoding = chardet.detect(Buffer.from(csvData));

  /** Convert the file to utf-8 from the detected encoding */
  const csv = iconv.decode(Buffer.from(csvData), encoding || "utf-8");
  const delimiter = guessDelimiters(csv, [",", ";"]);

  return new Promise<CSVData>((resolve, reject) => {
    const parser = parse({
      encoding: "utf-8", // Set encoding to utf-8
      delimiter, // Set delimiter
      bom: true, // Handle BOM
      quote: '"', // Set quote to " as this allows for commas in the data
      escape: '"', // Set escape to \ as this allows for commas in the data
      ltrim: true, // Trim whitespace from left side of cell
      relax_column_count: true, // Ignore inconsistent column count
    })
      .on("data", (data) => {
        // Process each row of data as it is parsed
        // @ts-ignore
        results.push(data);
      })
      .on("error", (error) => {
        reject(error);
      })
      .on("end", () => {
        resolve(results);
      });

    parser.write(csv);
    parser.end();
  });
};

/** Takes a request object and extracts the file from it and parses it as csvData */
export const csvDataFromRequest = async ({ request }: { request: Request }) => {
  try {
    // Upload handler to store file in memory
    const formData = await unstable_parseMultipartFormData(
      request,
      memoryUploadHandler
    );

    const csvFile = formData.get("file") as File;

    const csvData = await csvFile.arrayBuffer();

    return await parseCsv(csvData);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        cause instanceof CsvError
          ? cause.message
          : "Something went wrong while parsing the CSV file.",
      label: "CSV",
    });
  }
};

export const memoryUploadHandler = unstable_composeUploadHandlers(
  unstable_createMemoryUploadHandler()
);

export const buildCsvBackupDataFromAssets = ({
  assets,
  keysToSkip,
}: {
  assets: Asset[];
  keysToSkip: string[];
}) => {
  if (!assets.length) return [] as unknown as CSVData;
  return assets.map((asset) => {
    const toExport: string[] = [];

    /** Itterate over the values to create teh export object */
    Object.entries(asset).forEach(([key, value]) => {
      /** Skip keys that are not needed. These are foreign keys for the related entries */
      if (keysToSkip.includes(key)) return;

      /** If the value is null, push an empty string
       * We have a bit of a special case, for the relations that are objects, we need to push an empty object instead of an empty string.
       * This way we prevent the import from failing when importing the file again due to "Invalid JSON"
       * This needs to be done for all one-to-one relations
       */
      if (value === null) {
        if (["custody", "location", "category"].includes(key)) {
          return toExport.push("{}");
        }
        return toExport.push("");
      }

      /** Special handling for category and location */
      switch (key) {
        case "location":
        case "category":
        case "notes":
        case "tags":
        case "custody":
        case "organization":
        case "valuation":
        case "customFields":
          toExport.push(
            JSON.stringify(value, (_key, value) => {
              /** Custom replacer function.
               * We do this to ensure that in the result we have emtpy strings instead of null values
               */
              if (value === null) {
                return "";
              }
              return value;
            })
          );
          break;
        case "description":
          toExport.push(`"${String(value).replace(/\n|\r/g, "")}"`);
          break;
        default:
          toExport.push(String(value));
      }
    });

    return toExport;
  });
};

/* There are some keys that need to be skipped and require special handling */
const keysToSkip = [
  "userId",
  "organizationId",
  "categoryId",
  "locationId",
  "customFieldId",
  "mainImage",
  "mainImageExpiration",
];

export async function exportAssetsBackupToCsv({
  organizationId,
}: {
  organizationId: string;
}) {
  try {
    const assets = await fetchAssetsForExport({ organizationId });

    const csvData = buildCsvBackupDataFromAssets({
      assets,
      keysToSkip,
    });

    if (!csvData || !csvData.length) {
      throw new ShelfError({
        cause: null,
        title: "No assets to export",
        message:
          "Your workspace doesn't have any assets so there is nothing to export.",
        label: "CSV",
        shouldBeCaptured: false,
      });
    }

    /** Get the headers from the first row and filter out the keys to skip */
    const headers = Object.keys(assets[0]).filter(
      (header) => !keysToSkip.includes(header)
    );

    /** Add the header column */
    csvData.unshift(headers);

    /** Convert the data to a string */
    const csvRows = csvData.map((row) => row.join(";"));

    /** Join the rows with a new line */
    const csvString = csvRows.join("\n");

    return csvString;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while exporting the assets.",
      additionalData: { organizationId },
      label: "CSV",
    });
  }
}

export async function exportAssetsFromIndexToCsv({
  request,
  assetIds,
  organizationId,
  settings,
}: {
  request: Request;
  assetIds: string;
  organizationId: string;
  settings: AssetIndexSettings;
}) {
  /** Parse filters */
  const { filters } = await getAdvancedFiltersFromRequest(
    request,
    organizationId,
    settings
  );

  /** Make an array of the ids and check if we have to take all */
  const ids = assetIds.split(",");
  const takeAll = ids.includes(ALL_SELECTED_KEY);

  const { assets } = await getAdvancedPaginatedAndFilterableAssets({
    request,
    organizationId,
    filters,
    settings,
    takeAll,
    assetIds: takeAll ? undefined : ids,
  });

  // Pass both assets and columns to the build function
  const csvData = buildCsvExportDataFromAssets({
    assets,
    columns: [
      { name: "name", visible: true, position: 0 },
      ...(settings.columns as Column[]),
    ],
  });

  // Join rows with CRLF as per CSV spec
  return csvData.join("\r\n");
}

/**
 * Builds CSV export data from assets using the column settings to maintain order
 * @param assets - Array of assets to export
 * @param columns - Column settings that define the order and visibility of fields
 * @returns Array of string arrays representing CSV rows, including headers
 */
export const buildCsvExportDataFromAssets = ({
  assets,
  columns,
}: {
  assets: AdvancedIndexAsset[];
  columns: Column[];
}): string[][] => {
  if (!assets.length) return [];

  // Get visible columns in the correct order
  const visibleColumns = columns
    .filter((col) => col.visible)
    .sort((a, b) => a.position - b.position);

  // Create headers row using column names
  const headers = visibleColumns.map((col) =>
    formatValueForCsv(parseColumnName(col.name))
  );

  // Create data rows
  const rows = assets.map((asset) =>
    visibleColumns.map((column) => {
      // Handle different column types
      let value: any;

      // If it's not a custom field, it must be a fixed field or 'name'
      if (!column.name.startsWith("cf_")) {
        const fieldName = column.name as FixedField | "name";

        switch (fieldName) {
          case "id":
            value = asset.id;
            break;
          case "qrId":
            value = asset.qrId;
            break;
          case "name":
            value = asset.title;
            break;
          case "description":
            value = asset.description ?? "";
            break;
          case "category":
            value = asset.category?.name ?? "Uncategorized";
            break;
          case "location":
            value = asset.location?.name;
            break;
          case "kit":
            value = asset.kit?.name;
            break;
          case "custody":
            value = asset.custody
              ? resolveTeamMemberName(asset.custody.custodian)
              : "";
            break;
          case "tags":
            value = asset.tags?.map((t) => t.name).join(", ") ?? "";
            break;
          case "status":
            value = asset.status;
            break;
          case "createdAt":
            value = asset.createdAt
              ? new Date(asset.createdAt).toISOString()
              : "";
            break;
          case "valuation":
            value = asset.valuation;
            break;
          case "availableToBook":
            value = asset.availableToBook ? "Yes" : "No";
            break;
          case "upcomingReminder": {
            value = asset.upcomingReminder?.displayDate;
            break;
          }
          case "actions":
            value = "";
            break;
          default:
            checkExhaustiveSwitch(fieldName);
            value = "";
        }
      } else {
        // Handle custom fields
        const fieldName = column.name.replace("cf_", "");
        const customField = asset.customFields?.find(
          (cf) => cf.customField.name === fieldName
        );
        if (!customField) {
          value = "";
        } else {
          const fieldValue =
            customField.value as unknown as ShelfAssetCustomFieldValueType["value"];
          value = formatCustomFieldForCsv(fieldValue, column.cfType);
        }
      }

      return formatValueForCsv(value);
    })
  );

  // Return headers followed by data rows
  return [headers, ...rows];
};

/**
 * Cleans markdown formatting from a text string
 * @param text - Text containing markdown to clean
 * @returns Plain text with markdown formatting removed
 */
const cleanMarkdownFormatting = (text: string): string =>
  text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Remove markdown links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "") // Remove image references
    .replace(/[*_~`#|]+/g, "") // Remove markdown formatting
    .replace(/\[[^\]]*\]/g, "") // Remove remaining brackets
    .replace(/\([^)]*\)/g, "") // Remove remaining parentheses
    .replace(/\r?\n/g, " ") // Replace newlines with spaces
    .replace(/\s+/g, " ") // Normalize multiple spaces
    .trim();

/**
 * Safely formats a value for CSV export by properly escaping and quoting values
 */
const formatValueForCsv = (value: any): string => {
  // Handle null/undefined/empty values
  if (value === null || value === undefined || value === "") {
    return '""';
  }

  // Handle boolean values
  if (typeof value === "boolean") {
    return value ? '"Yes"' : '"No"';
  }

  // Convert to string and trim
  let stringValue = String(value).trim();

  // If empty after trim, return empty quoted string
  if (!stringValue) {
    return '""';
  }

  // For dates, ensure consistent format
  if (value instanceof Date) {
    stringValue = value.toISOString().split("T")[0];
  }

  // Clean any markdown formatting
  stringValue = cleanMarkdownFormatting(stringValue);

  // Escape quotes by doubling them
  stringValue = stringValue.replace(/"/g, '""');

  // Always wrap in quotes
  return `"${stringValue}"`;
};

/**
 * Formats a custom field value specifically for CSV export
 */
const formatCustomFieldForCsv = (
  fieldValue: ShelfAssetCustomFieldValueType["value"],
  cfType: CustomFieldType | undefined
): string => {
  if (!fieldValue || fieldValue.raw === undefined || fieldValue.raw === null) {
    return "";
  }

  switch (cfType) {
    case CustomFieldType.BOOLEAN:
      if (fieldValue.raw === undefined || fieldValue.raw === null) {
        return "";
      }
      return fieldValue.valueBoolean ? "Yes" : "No";

    case CustomFieldType.MULTILINE_TEXT:
      const rawText = String(fieldValue.raw || "");
      return cleanMarkdownFormatting(rawText);

    case CustomFieldType.DATE:
      if (!fieldValue.valueDate) return "";
      try {
        return format(new Date(fieldValue.valueDate), "yyyy-MM-dd");
      } catch {
        return String(fieldValue.raw);
      }

    default:
      return String(fieldValue.raw || "");
  }
};
