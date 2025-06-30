import { useState } from "react";
import { BarcodeType } from "@prisma/client";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { ChevronRight } from "~/components/icons/library";
import { tw } from "~/utils/tw";
import Input from "./input";
import { Button } from "../shared/button";
import When from "../when/when";

type BarcodeInput = {
  type: BarcodeType;
  value: string;
};

type BarcodesInputProps = {
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  typeName: (index: number) => string;
  valueName: (index: number) => string;
  barcodes: BarcodeInput[];
  typeError: (index: number) => string | undefined;
  valueError: (index: number) => string | undefined;
};

const BARCODE_TYPE_OPTIONS = [
  { value: BarcodeType.Code128, label: "Code 128" },
  { value: BarcodeType.Code39, label: "Code 39" },
  { value: BarcodeType.MicroQRCode, label: "Micro QR Code" },
];

export default function BarcodesInput({
  className,
  style,
  disabled,
  typeName,
  valueName,
  barcodes: incomingBarcodes,
  typeError,
  valueError,
}: BarcodesInputProps) {
  const [barcodes, setBarcodes] = useState<BarcodeInput[]>(
    incomingBarcodes.length === 0
      ? [{ type: BarcodeType.Code128, value: "" }]
      : incomingBarcodes
  );

  return (
    <div className={tw("w-full", className)} style={style}>
      {barcodes.map((barcode, i) => {
        // console.log(valueName(i));
        const typeErrorMessage = typeError(i);
        const valueErrorMessage = valueError(i);

        return (
          <div key={i} className="mb-3">
            <div className="flex items-start gap-x-2">
              {/* Barcode Type Select */}
              <div className="flex-1">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={disabled}
                      className="h-auto w-full justify-start truncate whitespace-nowrap px-[14px] py-2 text-text-md font-normal [&_span]:max-w-full [&_span]:truncate"
                    >
                      <ChevronRight className="ml-[2px] inline-block rotate-90 text-sm" />
                      <span className="ml-2 text-text-md">
                        {BARCODE_TYPE_OPTIONS.find(
                          (opt) => opt.value === barcode.type
                        )?.label || "Select barcode type"}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverPortal>
                    <PopoverContent
                      align="start"
                      className={tw(
                        "z-[999999] mt-2 max-h-[400px]  rounded-md border border-gray-200 bg-white"
                      )}
                    >
                      {BARCODE_TYPE_OPTIONS.map((option) => (
                        <div
                          key={option.value}
                          className={tw(
                            "px-4 py-2 !text-text-md text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                            barcode.type === option.value &&
                              "bg-gray-50 font-medium"
                          )}
                          onClick={() => {
                            barcodes[i].type = option.value as BarcodeType;
                            setBarcodes([...barcodes]);
                          }}
                        >
                          {option.label}
                        </div>
                      ))}
                    </PopoverContent>
                  </PopoverPortal>
                </Popover>
                <input type="hidden" name={typeName(i)} value={barcode.type} />
                <When truthy={!!typeErrorMessage}>
                  <p className="mt-1 text-sm text-red-500">
                    {typeErrorMessage}
                  </p>
                </When>
              </div>

              {/* Barcode Value Input */}
              <div className="flex-[2]">
                <Input
                  label="Barcode Value"
                  hideLabel
                  disabled={disabled}
                  name={valueName(i)}
                  defaultValue={barcode.value}
                  placeholder="Enter barcode value"
                  onChange={(e) => {
                    barcodes[i].value = e.target.value;
                    setBarcodes([...barcodes]);
                  }}
                />
                <When truthy={!!valueErrorMessage}>
                  <p className="mt-1 text-sm text-red-500">
                    {valueErrorMessage}
                  </p>
                </When>
              </div>

              {/* Remove Button */}
              <Button
                icon="x"
                className="py-2"
                variant="outline"
                type="button"
                disabled={barcodes.length === 1 || disabled}
                onClick={() => {
                  barcodes.splice(i, 1);
                  setBarcodes([...barcodes]);
                }}
              />
            </div>
          </div>
        );
      })}

      <Button
        icon="plus"
        className="py-3"
        variant="link"
        type="button"
        disabled={disabled}
        onClick={() => {
          setBarcodes((prev) => [
            ...prev,
            { type: BarcodeType.Code128, value: "" },
          ]);
        }}
      >
        Add another barcode
      </Button>
    </div>
  );
}
