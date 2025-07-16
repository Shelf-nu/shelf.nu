import type { BarcodeType } from "@prisma/client";

export interface BarcodeFormData {
  id?: string; // ID for existing barcodes
  type: BarcodeType;
  value: string;
}

/**
 * Extracts barcode data from FormData and returns valid barcodes
 * Handles form fields in the format: barcodes[0].type, barcodes[0].value, barcodes[0].id, etc.
 */
export function extractBarcodesFromFormData(
  formData: FormData
): BarcodeFormData[] {
  const barcodes: Array<{
    id?: string;
    type: BarcodeType | null;
    value: string;
  }> = [];

  // Extract barcode data from form
  for (const [key, value] of formData.entries()) {
    const match = key.match(/^barcodes\[(\d+)\]\.(.+)$/);
    if (match && value) {
      const index = parseInt(match[1]);
      const field = match[2];

      if (!barcodes[index]) {
        barcodes[index] = { type: null, value: "" };
      }

      if (field === "type") {
        barcodes[index].type = value as BarcodeType;
      } else if (field === "value") {
        barcodes[index].value = value as string;
      } else if (field === "id") {
        barcodes[index].id = value as string;
      }
    }
  }

  // Filter out incomplete barcodes and return only valid ones
  return barcodes.filter(
    (barcode): barcode is BarcodeFormData =>
      barcode.type !== null && !!barcode.value.trim()
  );
}
