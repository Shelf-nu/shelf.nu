import type {
  Asset,
  AssetIndexSettings,
  Note,
  Organization,
  Prisma,
  Tag,
  TeamMember,
} from "@prisma/client";
import { CustomFieldType } from "@prisma/client";
import {
  MaxFileSizeExceededError,
  parseFormData,
} from "@remix-run/form-data-parser";

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
import { isQuantityTracked } from "~/modules/asset/utils";
import type {
  BarcodeField,
  Column,
  FixedField,
} from "~/modules/asset-index-settings/helpers";
import {
  columnsLabelsMap,
  parseColumnName,
} from "~/modules/asset-index-settings/helpers";
import { BOOKING_COMMON_INCLUDE } from "~/modules/booking/constants";
import {
  getBookings,
  getBookingsFilterData,
} from "~/modules/booking/service.server";
import type { BookingWithCustodians } from "~/modules/booking/types";
import { calculatePartialCheckinProgress } from "~/modules/booking/utils.server";
import { getPrimaryCustody } from "~/modules/custody/utils";
import { getAssetTotalValue } from "./asset-value";
import { getBookingAssetCheckinLabel } from "./booking-assets";
import { checkExhaustiveSwitch } from "./check-exhaustive-switch";
import { getDateTimeFormat } from "./client-hints";
import { getAdvancedFiltersFromRequest } from "./cookies.server";
import { formatCurrency } from "./currency";
import { SERVER_URL } from "./env";
import { isLikeShelfError, ShelfError } from "./error";
import { ALL_SELECTED_KEY } from "./list";
import { cleanMarkdownFormatting } from "./markdown-cleaner";
import { sanitizeNoteContent } from "./note-sanitizer.server";
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

/** Checks if a CSV row is empty (all cells are empty or whitespace-only) */
function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

/** Walks the cause chain to check if a MaxFileSizeExceededError is present */
function isMaxFileSizeError(error: unknown): boolean {
  if (error instanceof MaxFileSizeExceededError) return true;
  const cause = (error as { cause?: unknown })?.cause;
  return cause ? isMaxFileSizeError(cause) : false;
}

/** Takes a request object and extracts the file from it and parses it as csvData */
export const csvDataFromRequest = async ({ request }: { request: Request }) => {
  try {
    // Files are automatically stored in memory with parseFormData
    const formData = await parseFormData(request);

    const csvFile = formData.get("file") as File;

    const csvData = await csvFile.arrayBuffer();

    const parsed = await parseCsv(csvData);

    // Filter out empty rows (keep the header row, filter data rows)
    if (parsed.length > 1) {
      const [header, ...dataRows] = parsed;
      const filteredRows = dataRows.filter((row) => !isEmptyRow(row));
      return [header, ...filteredRows] as CSVData;
    }

    return parsed;
  } catch (cause) {
    if (isMaxFileSizeError(cause)) {
      throw new ShelfError({
        cause,
        title: "File too large",
        message:
          "The CSV file is too large. Please reduce the file size by removing empty rows or splitting it into smaller files and try again.",
        label: "CSV",
        shouldBeCaptured: false,
      });
    }

    throw new ShelfError({
      cause,
      message:
        cause instanceof CsvError
          ? cause.message
          : "Something went wrong while parsing the CSV file.",
      label: "CSV",
      shouldBeCaptured: !(cause instanceof CsvError),
    });
  }
};

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
        if (["custody", "location", "category", "assetModel"].includes(key)) {
          return toExport.push("{}");
        }
        return toExport.push("");
      }

      /** Special handling for category and location.
       *
       * Phase A5: `assetModel` is included here — backup-export emits it
       * as a JSON `{ name }` object so the backup-import path can resolve
       * (or create) the model by name on restore (symmetric with the
       * `category` / `location` handling above). */
      switch (key) {
        case "location":
        case "category":
        case "notes":
        case "tags":
        case "custody":
        case "organization":
        case "valuation":
        case "customFields":
        case "assetModel":
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
  // Phase A5: backup-export now emits the resolved `assetModel` object
  // (`{ name }`) so cross-org restore can find / create the model by
  // name. The opaque FK column would only resolve in the source org and
  // can be safely dropped from the backup.
  "assetModelId",
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
  settings,
  currentOrganization,
  assetIndexCurrentSearchParams,
}: {
  request: Request;
  assetIds: string;
  settings: AssetIndexSettings;
  currentOrganization: Pick<
    Organization,
    "id" | "barcodesEnabled" | "currency"
  >;
  assetIndexCurrentSearchParams: string | null;
}) {
  /** Make an array of the ids and check if we have to take all */
  const ids = assetIds.split(",");
  const takeAll = ids.includes(ALL_SELECTED_KEY);

  /**
   * When taking all with filters (select all button), use the current page's search params
   * Otherwise, use cookie-based filters from the request
   */
  const filtersToUse =
    takeAll && assetIndexCurrentSearchParams
      ? assetIndexCurrentSearchParams
      : (
          await getAdvancedFiltersFromRequest(
            request,
            currentOrganization.id,
            settings
          )
        ).filters;

  const { assets } = await getAdvancedPaginatedAndFilterableAssets({
    request,
    organizationId: currentOrganization.id,
    filters: filtersToUse,
    settings,
    takeAll,
    assetIds: takeAll ? undefined : ids,
    canUseBarcodes: currentOrganization.barcodesEnabled ?? false,
  });
  const csvData = buildCsvExportDataFromAssets({
    assets,
    columns: [
      { name: "name", visible: true, position: 0 },
      ...(settings.columns as Column[]),
      // Synthetic export-only column: emits `valuation × quantity` so QT
      // inventories report total worth without overwriting the per-unit
      // `valuation` column (kept lossless for CSV → re-import round-trip).
      // Always appended at the end so existing user column ordering is
      // unaffected. Not in `defaultFields` / column-picker schema, so
      // users can't toggle or reorder it via settings.
      { name: "total_value", visible: true, position: Number.MAX_SAFE_INTEGER },
    ],
    currentOrganization,
    request,
  });

  // Join rows with CRLF as per CSV spec
  return csvData.join("\r\n");
}

/**
 * Builds CSV export data from assets using the column settings to maintain order
 * @param assets - Array of assets to export
 * @param columns - Column settings that define the order and visibility of fields
 * @param request - Request object for locale/timezone formatting
 * @returns Array of string arrays representing CSV rows, including headers
 */
export const buildCsvExportDataFromAssets = ({
  assets,
  columns,
  currentOrganization,
  request,
}: {
  assets: AdvancedIndexAsset[];
  columns: Column[];
  currentOrganization: Pick<
    Organization,
    "id" | "barcodesEnabled" | "currency"
  >;
  request: Request;
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

  // Create date formatter for reminder dates
  const formatDate = getDateTimeFormat(request, {
    dateStyle: "short",
    timeStyle: "short",
  }).format;

  // Create data rows
  const rows = assets.map((asset) =>
    visibleColumns.map((column) => {
      // Handle different column types
      let value: any;

      // If it's not a custom field, it must be a fixed field or 'name'
      if (!column.name.startsWith("cf_")) {
        const fieldName = column.name as
          | FixedField
          | BarcodeField
          | "name"
          | "total_value";

        switch (fieldName) {
          case "id":
            value = asset.id;
            break;
          case "sequentialId":
            value = asset.sequentialId ?? "";
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
          case "custody": {
            const primaryCustody = getPrimaryCustody(asset.custody);
            value = primaryCustody
              ? resolveTeamMemberName(primaryCustody.custodian)
              : "";
            break;
          }
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
          case "updatedAt":
            value = asset.updatedAt
              ? new Date(asset.updatedAt).toISOString()
              : "";
            break;
          case "valuation":
            // Per-unit price — matches `Asset.valuation` in the DB so CSV
            // round-trip (export → re-import) is lossless. The qty-aware
            // total is emitted separately under `total_value` (see below)
            // so users see both without breaking the import contract.
            // `!= null` so `valuation: 0` exports as "$0.00" instead of "".
            value =
              asset.valuation != null
                ? formatCurrency({
                    value: asset.valuation,
                    locale: "en-US", // Default locale for CSV exports
                    currency: currentOrganization.currency,
                  })
                : "";
            break;
          case "total_value":
            // Synthetic export-only column injected by the caller (see
            // `exportAssetsToCsv` and the `ColumnLabelKey` doc). Emits
            // `valuation × quantity` so QT inventories report correctly —
            // a Pens row stocked at 100 boxes at €1 each shows €100 here
            // while the `valuation` column above stays at €1 per-unit.
            value =
              asset.valuation != null
                ? formatCurrency({
                    value: getAssetTotalValue(asset),
                    locale: "en-US",
                    currency: currentOrganization.currency,
                  })
                : "";
            break;
          case "availableToBook":
            value = asset.availableToBook ? "Yes" : "No";
            break;
          case "upcomingReminder": {
            if (asset.upcomingReminder?.alertDateTime) {
              try {
                const date = new Date(asset.upcomingReminder.alertDateTime);
                // Check if date is valid
                if (!isNaN(date.getTime())) {
                  value = formatDate(date);
                } else {
                  value = "";
                }
              } catch {
                value = "";
              }
            } else {
              value = "";
            }
            break;
          }
          case "upcomingBookings": {
            value = asset.bookings
              ? asset.bookings.map((b) => b.name).join(", ")
              : "";
            break;
          }
          case "barcode_Code128":
          case "barcode_Code39":
          case "barcode_DataMatrix":
          case "barcode_ExternalQR":
          case "barcode_EAN13": {
            value =
              asset.barcodes?.find(
                (b) => b.type === columnsLabelsMap[fieldName].replace(/ /g, "")
              )?.value ?? "";
            break;
          }

          case "quantity":
            value =
              isQuantityTracked(asset) && asset.quantity != null
                ? `${asset.quantity}${
                    asset.unitOfMeasure ? ` ${asset.unitOfMeasure}` : ""
                  }`
                : "";
            break;
          case "type":
            // Handled by default column logic — asset.type is a direct string field
            value = isQuantityTracked(asset)
              ? "Tracked by quantity"
              : "Individual";
            break;
          case "assetModel":
            value = asset.assetModelName ?? "";
            break;
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
          value = formatCustomFieldForCsv(
            fieldValue,
            column.cfType,
            currentOrganization
          );
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
  cfType: CustomFieldType | undefined,
  currentOrganization: Pick<Organization, "id" | "barcodesEnabled" | "currency">
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

    case CustomFieldType.MULTILINE_TEXT: {
      const rawText = String(fieldValue.raw || "");
      return cleanMarkdownFormatting(rawText);
    }

    case CustomFieldType.DATE:
      if (!fieldValue.valueDate) return "";
      try {
        return format(new Date(fieldValue.valueDate), "yyyy-MM-dd");
      } catch {
        return String(fieldValue.raw);
      }

    case CustomFieldType.AMOUNT:
      return formatCurrency({
        value: fieldValue.raw as number,
        locale: "en-US", // Default locale for CSV exports
        currency: currentOrganization.currency,
      });

    default:
      return String(fieldValue.raw || "");
  }
};

/**
 * Builds the bookings CSV string for the export route.
 *
 * Resolves which bookings to export — either the explicit `bookingsIds`, or,
 * when the select-all sentinel is present, every booking matching the index's
 * current filters — then enriches them with batched partial check-in state and
 * delegates row construction to {@link buildCsvExportDataFromBookings}.
 *
 * @param request - The incoming request (carries filters, locale, timezone)
 * @param userId - The acting user, for filter scoping in the select-all path
 * @param bookingsIds - Selected booking IDs, or `[ALL_SELECTED_KEY]` for all
 * @param canSeeAllBookings - Whether the user may export bookings they don't own
 * @param organizationId - The active workspace; scopes every booking read
 * @returns The CSV body as a single CRLF-joined string
 * @throws {ShelfError} If fetching bookings or building rows fails
 */
export async function exportBookingsFromIndexToCsv({
  request,
  userId,
  bookingsIds,
  canSeeAllBookings,
  organizationId,
}: {
  request: Request;
  userId: string;
  bookingsIds: string[];
  canSeeAllBookings: boolean;
  organizationId: string;
}) {
  try {
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
        organizationId,
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
        extraInclude: { tags: { select: { name: true } } },
      });
      bookings = bookingsData.bookings;
    } else {
      bookings = await db.booking.findMany({
        where: { id: { in: bookingsIds }, organizationId },
        include: {
          ...BOOKING_COMMON_INCLUDE,
          bookingAssets: {
            select: {
              /**
               * `quantity` and `asset.type` are needed so the CSV builder
               * can render `"Title × N"` for QUANTITY_TRACKED assets.
               * Without these the row would silently show just the
               * title and drop the booked quantity. `asset.id` is
               * required to match each row against the booking's
               * partial check-ins for the per-asset check-in status
               * column added by the booking export checkin-status feature.
               */
              quantity: true,
              asset: {
                select: {
                  id: true,
                  title: true,
                  type: true,
                },
              },
            },
          },
          tags: { select: { name: true } },
        },
      });
    }

    // Fetch partial check-in state for the exported bookings in a single
    // batched query (avoids an N+1 across the selection) so the export can
    // surface which assets are still checked out vs already returned.
    const checkinsByBooking = await buildBookingCheckinMap(
      bookings.map((booking) => booking.id)
    );

    // Pass both assets and columns to the build function
    const csvData = buildCsvExportDataFromBookings(
      bookings as FlexibleBooking[],
      request,
      checkinsByBooking
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
      additionalData: { bookingsIds, organizationId },
      label: "Booking",
    });
  }
}

const ACTIVITY_HEADER = "Date,Author,Type,Content";

type ActivityNote = Pick<Note, "content" | "createdAt" | "type"> & {
  user: {
    firstName: string | null;
    lastName: string | null;
  } | null;
};

const sanitizeCsvValue = (value: string | null | undefined) =>
  formatValueForCsv((value ?? "").replace(/\r?\n/g, " "));

const notesToCsv = (notes: ActivityNote[], formatter: Intl.DateTimeFormat) => {
  const rows = notes.map((note) => {
    const author = note.user
      ? [note.user.firstName, note.user.lastName]
          .filter(Boolean)
          .join(" ")
          .trim()
      : "";

    return [
      sanitizeCsvValue(formatter.format(note.createdAt)),
      sanitizeCsvValue(author),
      sanitizeCsvValue(note.type),
      sanitizeCsvValue(sanitizeNoteContent(note.content ?? "", formatter)),
    ].join(",");
  });

  return [ACTIVITY_HEADER, ...rows].join("\n");
};

type ActivityNoteRecord = {
  user: {
    firstName: string | null;
    lastName: string | null;
  } | null;
  content: string | null;
  createdAt: Date;
  type: string;
};

type NoteFetcher<Where> = (args: {
  where: Where;
  include: {
    user: {
      select: {
        firstName: true;
        lastName: true;
        displayName: true;
      };
    };
  };
  orderBy: {
    createdAt: "desc";
  };
}) => Promise<ActivityNoteRecord[]>;

type ExportNotesToCsvArgs<Where> = {
  request: Request;
  where: Where;
  findMany: NoteFetcher<Where>;
};

async function exportNotesToCsv<Where>({
  request,
  where,
  findMany,
}: ExportNotesToCsvArgs<Where>) {
  const formatter = getDateTimeFormat(request, {
    dateStyle: "short",
    timeStyle: "short",
  });

  const notes = await findMany({
    where,
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const activityNotes = notes.map<ActivityNote>((note) => ({
    content: note.content ?? "",
    createdAt: note.createdAt,
    type: note.type as ActivityNote["type"],
    user: note.user
      ? {
          firstName: note.user.firstName,
          lastName: note.user.lastName,
        }
      : null,
  }));

  return notesToCsv(activityNotes, formatter);
}

export async function exportAssetNotesToCsv({
  request,
  assetId,
  organizationId,
}: {
  request: Request;
  assetId: string;
  organizationId: string;
}) {
  return exportNotesToCsv<Prisma.NoteWhereInput>({
    request,
    where: {
      assetId,
      asset: { organizationId },
    },
    findMany: (args) => db.note.findMany(args) as Promise<ActivityNoteRecord[]>,
  });
}

export async function exportBookingNotesToCsv({
  request,
  bookingId,
  organizationId,
}: {
  request: Request;
  bookingId: string;
  organizationId: string;
}) {
  return exportNotesToCsv<Prisma.BookingNoteWhereInput>({
    request,
    where: {
      bookingId,
      booking: { organizationId },
    },
    findMany: (args) =>
      db.bookingNote.findMany(args) as Promise<ActivityNoteRecord[]>,
  });
}

export async function exportAuditNotesToCsv({
  request,
  auditId,
  organizationId,
}: {
  request: Request;
  auditId: string;
  organizationId: string;
}) {
  return exportNotesToCsv<Prisma.AuditNoteWhereInput>({
    request,
    where: {
      auditSessionId: auditId,
      auditSession: { organizationId },
    },
    findMany: (args) =>
      db.auditNote.findMany(args) as Promise<ActivityNoteRecord[]>,
  });
}

export async function exportLocationNotesToCsv({
  request,
  locationId,
  organizationId,
}: {
  request: Request;
  locationId: string;
  organizationId: string;
}) {
  return exportNotesToCsv<Prisma.LocationNoteWhereInput>({
    request,
    where: {
      locationId,
      location: { organizationId },
    },
    findMany: (args) =>
      db.locationNote.findMany(args) as Promise<ActivityNoteRecord[]>,
  });
}

/**
 * Normalized asset shape shared across the different booking export fetches —
 * always has a `title`, with the remaining asset fields optional.
 */
type FlexibleAsset = Partial<Asset> & {
  title: string;
};

/**
 * Normalized booking shape the CSV builder consumes, regardless of which fetch
 * path (by-id vs. select-all) produced it: a booking with its custodians, the
 * BookingAsset pivot list (each with optional `quantity` + {@link FlexibleAsset}),
 * and name-only tags.
 *
 * `quantity` is optional so the type accepts bookings fetched without it
 * (falls back to "no quantity annotation" in the renderer), but both query
 * paths in `exportBookingsFromIndexToCsv` now populate it.
 */
type FlexibleBooking = Omit<BookingWithCustodians, "bookingAssets"> & {
  bookingAssets: { quantity?: number; asset: FlexibleAsset }[];
  tags: Pick<Tag, "name">[];
};

/**
 * Per-booking partial check-in state needed by the CSV export.
 * - `checkedInAssetIds`: set of asset IDs that have been (partially) checked in
 * - `checkinDateByAsset`: earliest check-in timestamp per asset, for the date column
 */
type BookingCheckinInfo = {
  checkedInAssetIds: Set<string>;
  checkinDateByAsset: Map<string, Date>;
};

/**
 * Batch-fetch partial check-in state for a set of bookings.
 *
 * Reads every {@link PartialBookingCheckin} for the given bookings in one query
 * and folds them into a per-booking lookup. For each asset only the earliest
 * check-in is kept (an asset can in principle appear in more than one check-in
 * session), matching {@link getDetailedPartialCheckinData}'s "first wins" rule.
 *
 * @param bookingIds - The bookings being exported
 * @returns Map of bookingId → {@link BookingCheckinInfo}; bookings with no
 *   partial check-ins are simply absent from the map
 */
async function buildBookingCheckinMap(
  bookingIds: string[]
): Promise<Map<string, BookingCheckinInfo>> {
  const map = new Map<string, BookingCheckinInfo>();

  if (!bookingIds.length) {
    return map;
  }

  const checkins = await db.partialBookingCheckin.findMany({
    where: { bookingId: { in: bookingIds } },
    select: { bookingId: true, assetIds: true, checkinTimestamp: true },
    // Earliest first so the "first check-in wins" assignment below is stable.
    orderBy: { checkinTimestamp: "asc" },
  });

  for (const checkin of checkins) {
    let info = map.get(checkin.bookingId);
    if (!info) {
      info = {
        checkedInAssetIds: new Set<string>(),
        checkinDateByAsset: new Map<string, Date>(),
      };
      map.set(checkin.bookingId, info);
    }

    for (const assetId of checkin.assetIds) {
      info.checkedInAssetIds.add(assetId);
      // Keep the earliest check-in per asset (rows are ordered ascending).
      if (!info.checkinDateByAsset.has(assetId)) {
        info.checkinDateByAsset.set(assetId, checkin.checkinTimestamp);
      }
    }
  }

  return map;
}

/**
 * Builds CSV export data from bookings.
 *
 * Each booking is emitted as a "main" row (booking fields + its first asset)
 * followed by one row per additional asset. Per-asset columns
 * (`Assets`, `Item check-in status`, `Check-in date`) are populated on every
 * row for that row's asset; booking-level columns are populated on the main
 * row only and left blank on the trailing asset rows.
 *
 * @param bookings - Array of bookings to export
 * @param request - Request object for locale/timezone formatting
 * @param checkinsByBooking - Per-booking partial check-in state, from
 *   {@link buildBookingCheckinMap}. Used to derive the per-asset check-in
 *   status/date columns and the booking-level checked-in rollup.
 * @returns Array of string arrays representing CSV rows, including headers
 */
/**
 * Render a booking-asset row label for the CSV "Assets" column.
 *
 * For QUANTITY_TRACKED assets we append `" × N"` so the exported sheet
 * shows the booked quantity — matching the display convention used in
 * booking emails and the booking PDF. INDIVIDUAL assets render as just
 * the title (quantity is implicitly 1).
 *
 * Falls back gracefully when the asset type or quantity is missing
 * (e.g. older tests or legacy fixtures that don't provide those fields).
 */
const formatBookingAssetForCsv = (ba: {
  quantity?: number;
  asset: FlexibleAsset;
}): string => {
  const title = ba.asset.title || "Unnamed Asset";
  const isQtyTracked = ba.asset.type === "QUANTITY_TRACKED";
  if (isQtyTracked && ba.quantity != null && ba.quantity > 0) {
    return `${title} × ${ba.quantity}`;
  }
  return title;
};

export const buildCsvExportDataFromBookings = (
  bookings: FlexibleBooking[],
  request: Request,
  checkinsByBooking: Map<string, BookingCheckinInfo> = new Map()
): string[][] => {
  if (!bookings.length) return [];

  // Create date formatter for CSV export
  const format = getDateTimeFormat(request, {
    dateStyle: "short",
    timeStyle: "short",
  }).format;

  // Create headers row using column names. The check-in columns are appended
  // last so existing consumers that key off earlier column positions are
  // unaffected. Per-asset columns (assetCheckinStatus/assetCheckinDate) sit
  // beside `asset`; the booking-level rollup (checkedInCount/totalAssets)
  // follows.
  const headers = {
    url: "Booking URL", // custom string
    id: "Booking ID", // string
    name: "Name", // string
    status: "Status", // string
    from: "Actual start date", // date
    originalFrom: "Planned start date",
    to: "Actual end date", // date
    originalTo: "Planned end date",
    custodian: "Custodian",
    description: "Description", // string
    tags: "Tags",
    asset: "Assets", // asset title (per row)
    assetCheckinStatus: "Item check-in status", // "Checked in" / "Checked out" (per asset)
    assetCheckinDate: "Check-in date", // when the asset was checked in (per asset)
    checkedInCount: "Checked in", // assets returned for this booking (per booking)
    totalAssets: "Total assets", // assets on this booking (per booking)
  };

  // Create data rows with assets
  const rows: string[][] = [];

  bookings.forEach((booking) => {
    // Normalise to a non-empty list of BookingAsset pivot rows so a booking
    // with no assets still emits a single row. The placeholder has no asset
    // id, so its check-in / status columns stay blank.
    const bookingAssetRows =
      booking.bookingAssets && booking.bookingAssets.length > 0
        ? booking.bookingAssets
        : [
            {
              quantity: undefined,
              asset: {
                id: undefined as unknown as string | undefined,
                title: "No assets",
              } as FlexibleAsset,
            },
          ];

    // Per-booking partial check-in state. `calculatePartialCheckinProgress` is
    // the same helper that powers the booking detail "X / Y checked in" bar, so
    // the export rollup matches what users see in-app. Count UNIQUE assets
    // (not slices) — a qty-tracked asset with one standalone + one kit-driven
    // slice is still one asset for progress purposes.
    const checkinInfo = checkinsByBooking.get(booking.id);
    const checkedInAssetIds =
      checkinInfo?.checkedInAssetIds ?? new Set<string>();
    const uniqueAssetIdCount = new Set(
      (booking.bookingAssets ?? [])
        .map((ba) => ba.asset.id)
        .filter((id): id is string => Boolean(id))
    ).size;
    const progress = calculatePartialCheckinProgress(
      uniqueAssetIdCount,
      [...checkedInAssetIds],
      booking.status
    );

    bookingAssetRows.forEach((ba, index) => {
      // The first BookingAsset row shares the booking's "main" row; the rest
      // get their own rows with booking-level columns blanked.
      const isMainRow = index === 0;
      const asset = ba.asset;

      const row = Object.keys(headers).map((column) => {
        // --- Per-asset columns: populated on every row for that asset ---
        if (column === "asset") {
          // formatBookingAssetForCsv adds the "× N" suffix for qty-tracked.
          return formatValueForCsv(
            asset.id
              ? formatBookingAssetForCsv(ba)
              : asset.title ?? "No assets",
            false
          );
        }
        if (column === "assetCheckinStatus") {
          const label = asset.id
            ? getBookingAssetCheckinLabel(
                asset.id,
                checkedInAssetIds,
                booking.status
              )
            : "";
          return formatValueForCsv(label, false);
        }
        if (column === "assetCheckinDate") {
          const checkinDate = asset.id
            ? checkinInfo?.checkinDateByAsset.get(asset.id)
            : undefined;
          return formatValueForCsv(
            checkinDate ? format(checkinDate) : "",
            false
          );
        }

        // --- Booking-level columns: main row only, blank on asset rows ---
        if (!isMainRow) {
          return formatValueForCsv("", false);
        }

        let value: any;
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
          case "status":
            value =
              booking.status.charAt(0).toUpperCase() +
              booking.status.slice(1).toLowerCase();
            break;
          case "from":
            value = booking.from ? format(booking.from).split(",") : "";
            break;
          case "originalFrom":
            value = booking.originalFrom
              ? format(booking.originalFrom).split(",")
              : booking.from
              ? format(booking.from).split(",")
              : "";
            break;
          case "to":
            value = booking.to ? format(booking.to).split(",") : "";
            break;
          case "originalTo":
            value = booking.originalTo
              ? format(booking.originalTo).split(",")
              : booking.to
              ? format(booking.to).split(",")
              : "";
            break;
          case "custodian": {
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
          }
          case "description":
            value = booking.description ?? "";
            break;
          case "tags":
            value = booking.tags.length
              ? booking.tags.map((tag) => tag.name).join(", ")
              : "No tags";
            break;
          case "checkedInCount":
            value = progress.checkedInCount;
            break;
          case "totalAssets":
            value = progress.totalAssets;
            break;
          default:
            value = "";
        }
        return formatValueForCsv(value, false);
      });

      rows.push(row);
    });
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
