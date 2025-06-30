import { useState } from "react";
import { BarcodeType } from "@prisma/client";
import { tw } from "~/utils/tw";
import Input from "./input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
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
        const typeErrorMessage = typeError(i);
        const valueErrorMessage = valueError(i);

        return (
          <div key={i} className="mb-3">
            <div className="flex items-start gap-x-2">
              {/* Barcode Type Select */}
              <div className="flex-1">
                <Select
                  disabled={disabled}
                  name={typeName(i)}
                  defaultValue={barcode.type}
                  onValueChange={(value) => {
                    barcodes[i].type = value as BarcodeType;
                    setBarcodes([...barcodes]);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select barcode type" />
                  </SelectTrigger>
                  <SelectContent>
                    {BARCODE_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
