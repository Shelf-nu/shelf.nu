import type { Asset } from "@prisma/client";
import {
  unstable_composeUploadHandlers,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import chardet from "chardet";
import { CsvError, parse } from "csv-parse";
import iconv from "iconv-lite";
import { fetchAssetsForExport } from "~/modules/asset/service.server";
import { isLikeShelfError, ShelfError } from "./error";

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

  return new Promise((resolve, reject) => {
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

    return (await parseCsv(csvData)) as CSVData;
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

export const buildCsvDataFromAssets = ({
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

export async function exportAssetsToCsv({
  organizationId,
}: {
  organizationId: string;
}) {
  try {
    const assets = await fetchAssetsForExport({ organizationId });

    const csvData = buildCsvDataFromAssets({
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
