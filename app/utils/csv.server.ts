import {
  unstable_composeUploadHandlers,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import { parse } from "csv-parse";

export type CSVData = [string[], ...string[][]] | [];

/** Parses csv Data into an array with type {@link CSVData} */
export const parseCsv = (csvData: string) => {
  const results = [] as CSVData;
  return new Promise((resolve, reject) => {
    const parser = parse({
      delimiter: ";", // Set delimiter to ; as this allows for commas in the data
      quote: '"', // Set quote to " as this allows for commas in the data
      escape: "\\", // Set escape to \ as this allows for commas in the data
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

    parser.write(csvData);
    parser.end();
  });
};

/** Takes a request object and extracts the file from it and parses it as csvData */
export const csvDataFromRequest = async ({ request }: { request: Request }) => {
  // Upload handler to store file in memory
  const formData = await unstable_parseMultipartFormData(
    request,
    memoryUploadHandler
  );

  const csvFile = formData.get("file") as File;
  const csvData = Buffer.from(await csvFile.arrayBuffer()).toString("utf-8"); // Convert Uint8Array to string

  return (await parseCsv(csvData)) as CSVData;
};

export const memoryUploadHandler = unstable_composeUploadHandlers(
  unstable_createMemoryUploadHandler()
);
