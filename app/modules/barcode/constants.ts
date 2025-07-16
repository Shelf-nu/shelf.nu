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
];
