import { BarcodeType } from "@prisma/client";

export const BARCODE_TYPE_OPTIONS = [
  {
    value: BarcodeType.Code128,
    label: "Code 128",
    description:
      "4-40 characters, supports letters, numbers, and symbols (e.g., ABC-123)",
  },
  {
    value: BarcodeType.Code39,
    label: "Code 39",
    description: "4-43 characters, letters and numbers only (e.g., ABC123)",
  },
  {
    value: BarcodeType.DataMatrix,
    label: "DataMatrix",
    description:
      "4-100 characters, supports letters, numbers, and symbols (e.g., ABC-123)",
  },
  {
    value: BarcodeType.ExternalQR,
    label: "External QR",
    description:
      "1-2048 characters, URLs, text, or any external QR content (e.g., https://example.com)",
  },
  {
    value: BarcodeType.EAN13,
    label: "EAN-13",
    description:
      "Exactly 13 numeric digits. For retail barcodes (13-digit product identification codes)",
  },
];
