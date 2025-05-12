import type {
  Asset,
  AssetIndexSettings,
  Organization,
  Prisma,
  TeamMember,
} from "@prisma/client";
import { CustomFieldType } from "@prisma/client";
import {
  unstable_composeUploadHandlers,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import chardet from "chardet";
import { CsvError, parse } from "csv-parse";
import { format } from "date-fns";
import iconv from "iconv-lite";
import { db } from "~/database/db.server";
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
import { BOOKING_COMMON_INCLUDE } from "~/modules/booking/constants";
import {
  getBookings,
  getBookingsFilterData,
} from "~/modules/booking/service.server";
import type { BookingWithCustodians } from "~/modules/booking/types";
import { formatBookingsDates } from "~/modules/booking/utils.server";
import { checkExhaustiveSwitch } from "./check-exhaustive-switch";
import { getAdvancedFiltersFromRequest } from "./cookies.server";
import { SERVER_URL } from "./env";
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
    .filter((col) => col.visible && col.name !== "actions")
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

      const isMarkdown = column.cfType === CustomFieldType.MULTILINE_TEXT;
      return formatValueForCsv(value, isMarkdown);
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
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_match, group1, group2) => group1 + ":" + group2
    ) // Replace markdown links: [text](url) -> text:url
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "") // Remove image references: ![alt](url)
    .replace(/[*_~`#|]+/g, "") // Remove markdown formatting characters
    .replace(/\[[^\]]*\]/g, "") // Remove remaining brackets, e.g., [text]
    .replace(/\r?\n/g, " ") // Replace newlines with spaces
    .replace(/\s+/g, " ") // Normalize multiple spaces
    .replace(/^## /, "") // Remove '## ' from the start
    .trim();

/**
 * Safely formats a value for CSV export by properly escaping and quoting values
 */
export const formatValueForCsv = (value: any, isMarkdown = false): string => {
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
  if (isMarkdown) {
    stringValue = cleanMarkdownFormatting(stringValue);
  }

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

export async function exportBookingsFromIndexToCsv({
  request,
  userId,
  bookingsIds,
  canSeeAllBookings,
  currentOrganization,
}: {
  request: Request;
  userId: string;
  bookingsIds: string[];
  canSeeAllBookings: boolean;
  currentOrganization: Pick<
    Organization,
    "id" | "selfServiceCanSeeBookings" | "baseUserCanSeeBookings"
  >;
}) {
  try {
    const organizationId = currentOrganization.id;
    const hasSelectAll = bookingsIds.includes(ALL_SELECTED_KEY);

    /** If all are selected in the list, then we have to consider filter to get the entries */
    let bookings;
    if (hasSelectAll) {
      // Here we need to use the getBookings the same way as in the index with all filters and everything
      const {
        page,
        search,
        status,
        teamMemberIds,
        orderBy,
        orderDirection,
        selfServiceData,
      } = await getBookingsFilterData({
        request,
        canSeeAllBookings,
        currentOrganization,
        userId,
      });

      const bookingsData = await getBookings({
        page,
        takeAll: true,
        organizationId,
        search,
        userId,
        ...(status && {
          // If status is in the params, we filter based on it
          statuses: [status],
        }),
        custodianTeamMemberIds: teamMemberIds,
        ...selfServiceData,
        orderBy,
        orderDirection,
      });
      bookings = bookingsData.bookings;
    } else {
      bookings = await db.booking.findMany({
        where: { id: { in: bookingsIds }, organizationId },
        include: {
          ...BOOKING_COMMON_INCLUDE,
          assets: {
            select: {
              title: true,
            },
          },
        },
      });
    }

    bookings = formatBookingsDates(bookings, request);

    // Pass both assets and columns to the build function
    const csvData = buildCsvExportDataFromBookings(
      bookings as FlexibleBooking[]
    );

    // Join rows with CRLF as per CSV spec
    return csvData.join("\r\n");
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while bulk archive booking.";

    throw new ShelfError({
      cause,
      message,
      additionalData: { bookingsIds, currentOrganization },
      label: "Booking",
    });
  }
}

/** Define some types to use for normalizing bookings across the different fetches */
type FlexibleAsset = Partial<Asset> & {
  title: string;
};

type FlexibleBooking = Omit<BookingWithCustodians, "assets"> & {
  assets: FlexibleAsset[];
  displayFrom?: string;
  displayTo?: string;
  displayOriginalFrom?: string;
  displayOriginalTo?: string;
};

/**
 * Builds CSV export data from bookings
 * @param bookings - Array of bookings to export
 * @returns Array of string arrays representing CSV rows, including headers
 */
export const buildCsvExportDataFromBookings = (
  bookings: FlexibleBooking[]
): string[][] => {
  if (!bookings.length) return [];

  // Create headers row using column names
  const headers = {
    url: "Booking URL", // custom string
    id: "Booking ID", // string
    name: "Name", // string
    from: "Start date", // date
    to: "End date", // date
    custodian: "Custodian",
    description: "Description", // string
    asset: "Assets", // New column for assets
    originalFrom: "Original start date",
    originalTo: "Original end date",
  };

  // Create data rows with assets
  const rows: string[][] = [];

  bookings.forEach((booking) => {
    // Get the first asset's title if available
    const firstAsset =
      booking.assets && booking.assets.length > 0
        ? booking.assets[0]
        : { title: "No assets" };

    // First add the main booking row (including the first asset)
    const bookingRow = Object.keys(headers).map((column) => {
      // Handle different column types
      let value: any;

      // If it's not a custom field, it must be a fixed field or 'name'
      switch (column) {
        case "url":
          value = `${SERVER_URL}/bookings/${booking.id}`;
          break;
        case "id":
          value = booking.id;
          break;
        case "name":
          value = booking.name;
          break;
        case "from":
          value = booking.displayFrom;
          break;
        case "to":
          value = booking.displayTo;
          break;
        case "custodian":
          const teamMember = {
            name: booking.custodianTeamMember?.name ?? "",
            user: booking?.custodianUser
              ? {
                  firstName: booking.custodianUser?.firstName,
                  lastName: booking.custodianUser?.lastName,
                  email: booking.custodianUser?.email,
                }
              : null,
          };

          value = resolveTeamMemberName(teamMember, true);
          break;
        case "description":
          value = booking.description ?? "";
          break;
        case "asset":
          // Include the first asset title in the main booking row
          value = firstAsset ? firstAsset.title || "Unnamed Asset" : "";
          break;
        case "originalFrom":
          value = booking.displayOriginalFrom
            ? booking.displayOriginalFrom
            : booking.displayFrom;
          break;

        case "originalTo":
          value = booking.displayOriginalTo
            ? booking.displayOriginalTo
            : booking.displayTo;
          break;
        default:
          value = "";
      }
      return formatValueForCsv(value, false);
    });

    rows.push(bookingRow);

    // Then add remaining asset rows if the booking has more than one asset
    if (booking.assets && booking.assets.length > 1) {
      // Start from the second asset (index 1)
      booking.assets.slice(1).forEach((asset) => {
        // Create an asset row with empty values for all columns except 'asset'
        const assetRow = Object.keys(headers).map((column) => {
          if (column === "asset") {
            // Assuming asset has a title property
            return formatValueForCsv(asset.title || "Unnamed Asset", false);
          }
          // Empty values for all other columns
          return formatValueForCsv("", false);
        });

        rows.push(assetRow);
      });
    }
  });

  // Return headers followed by data rows
  return [Object.values(headers), ...rows];
};

export async function exportNRMsToCsv({
  nrmIds,
  organizationId,
}: {
  nrmIds: TeamMember["id"][];
  organizationId: Organization["id"];
}) {
  try {
    const where: Prisma.TeamMemberWhereInput = nrmIds.includes(ALL_SELECTED_KEY)
      ? { organizationId }
      : { id: { in: nrmIds }, organizationId };

    const teamMembers = await db.teamMember.findMany({
      where,
      include: { _count: { select: { custodies: true } } },
    });

    return buildCsvExportDataFromTeamMembers({ teamMembers });
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Team Member",
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while exporting NRMs to csv.",
      additionalData: { nrmIds, organizationId },
    });
  }
}

export function buildCsvExportDataFromTeamMembers({
  teamMembers,
}: {
  teamMembers: Prisma.TeamMemberGetPayload<{
    include: { _count: { select: { custodies: true } } };
  }>[];
}) {
  try {
    const headers = {
      id: "Id",
      name: "Name",
      custodies: "Custodies",
    };

    const rows: string[][] = [];

    teamMembers.forEach((teamMember) => {
      let value = "";

      const teamMemberRow = Object.keys(headers).map((header) => {
        switch (header) {
          case "id":
            value = teamMember.id;
            break;

          case "name":
            value = teamMember.name;
            break;

          case "custodies":
            value = teamMember._count.custodies.toString();
            break;

          default:
            value = "";
        }

        return formatValueForCsv(value, false);
      });

      rows.push(teamMemberRow);
    });

    const finalCsv = [Object.values(headers), ...rows];

    // Join rows with CRLF as per CSV spec
    return finalCsv.join("\r\n");
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Team Member",
      message:
        "Something went wrong while building csv from team members data.",
    });
  }
}
