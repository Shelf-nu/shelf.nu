import type { ReactNode } from "react";
import type { Barcode } from "@prisma/client";
import { SearchIcon } from "lucide-react";
import { tw } from "~/utils/tw";
import { BarcodeDisplay } from "./barcode-display";

export const BarcodeCard = ({
  barcode,
}: {
  barcode: Pick<Barcode, "id" | "value" | "type">;
}) => (
  <div
    className="flex w-full max-w-full shrink-0 flex-col rounded-lg border bg-gray-50 p-3 md:w-auto md:max-w-[400px]"
    style={{ minWidth: "280px" }}
  >
    <div
      className="mb-2 flex items-center gap-1 truncate"
      title={`${barcode.type}: ${barcode.value}`}
    >
      <span className="inline-flex w-fit items-center rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
        {barcode.type}
      </span>
      <span className="max-w-full  truncate font-mono text-gray-700">
        {barcode.value}
      </span>
      {barcode.type === "EAN13" && (
        <Ean13LookupLink value={barcode.value} className="ml-auto" />
      )}
    </div>
    <div
      className="flex flex-1 flex-col items-center justify-center rounded bg-white p-2"
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

export function Ean13LookupLink({
  value,
  className,
  content,
}: {
  value: string;
  className?: string;
  /** Replaces default icon */
  content?: ReactNode | string;
}) {
  return (
    <a
      href={`https://www.google.com/search?q=${encodeURIComponent(value)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={tw("inline-flex items-center gap-1 text-sm", className)}
      title={`Search for product ${value} on Google`}
    >
      {content || <SearchIcon className="size-4" />}
    </a>
  );
}
