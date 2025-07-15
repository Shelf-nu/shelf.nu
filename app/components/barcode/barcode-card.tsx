import type { Barcode } from "@prisma/client";
import { BarcodeDisplay } from "./barcode-display";

export const BarcodeCard = ({
  barcode,
}: {
  barcode: Pick<Barcode, "id" | "value" | "type">;
}) => (
  <div
    className="shrink-0 rounded-lg border bg-gray-50 p-3"
    style={{ minWidth: "280px" }}
  >
    <div
      className="mb-2 flex items-center gap-1 truncate"
      title={`${barcode.type}: ${barcode.value}`}
    >
      <span className="inline-flex w-fit items-center rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
        {barcode.type}
      </span>
      <span className="font-mono  text-gray-700">{barcode.value}</span>
    </div>
    <div
      className="flex flex-col items-center justify-center rounded bg-white p-2"
      title={`${barcode.type}: ${barcode.value}`}
    >
      <BarcodeDisplay
        type={barcode.type}
        value={barcode.value}
        maxWidth="280px"
      />
    </div>
  </div>
);
