import { useState, forwardRef, useImperativeHandle, useMemo } from "react";
import { BarcodeType } from "@prisma/client";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { ChevronRight } from "~/components/icons/library";
import { validateBarcodeValue } from "~/modules/barcode/validation";
import { tw } from "~/utils/tw";
import Input from "./input";
import { Button } from "../shared/button";
import When from "../when/when";

type BarcodeInput = {
  id?: string; // ID for existing barcodes
  type: BarcodeType;
  value: string;
};

type BarcodesInputProps = {
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  typeName: (index: number) => string;
  valueName: (index: number) => string;
  idName?: (index: number) => string; // Optional ID field name generator
  barcodes: BarcodeInput[];
};

export type BarcodesInputRef = {
  hasErrors: () => boolean;
  getErrors: () => string[];
  validateAll: () => void; // Force validation of all fields
};

const BARCODE_TYPE_OPTIONS = [
  { value: BarcodeType.Code128, label: "Code 128" },
  { value: BarcodeType.Code39, label: "Code 39" },
  { value: BarcodeType.MicroQRCode, label: "Micro QR Code" },
];

const BarcodesInput = forwardRef<BarcodesInputRef, BarcodesInputProps>(
  function BarcodesInput(
    {
      className,
      style,
      disabled,
      typeName,
      valueName,
      idName,
      barcodes: incomingBarcodes,
    },
    ref
  ) {
    const [barcodes, setBarcodes] = useState<BarcodeInput[]>(incomingBarcodes);
    const [touchedFields, setTouchedFields] = useState<Set<number>>(new Set());

    // Custom validation logic
    const validationErrors = useMemo(() => {
      const errors: { [key: number]: string } = {};
      const values = new Set<string>();

      barcodes.forEach((barcode, index) => {
        // If a barcode row exists, value is required
        if (!barcode.value.trim()) {
          errors[index] = "Barcode value is required";
          return;
        }

        // Validate the barcode value format
        const error = validateBarcodeValue(barcode.type, barcode.value);
        if (error) {
          errors[index] = error;
          return;
        }

        // Check for duplicates
        if (values.has(barcode.value.toUpperCase())) {
          errors[index] = "Duplicate barcode values are not allowed";
          return;
        }

        values.add(barcode.value.toUpperCase());
      });

      return errors;
    }, [barcodes]);

    // Expose validation state to parent
    useImperativeHandle(
      ref,
      () => ({
        hasErrors: () => Object.keys(validationErrors).length > 0,
        getErrors: () => Object.values(validationErrors),
        validateAll: () => {
          // Mark all fields as touched to show all validation errors
          setTouchedFields(new Set(barcodes.map((_, index) => index)));
        },
      }),
      [validationErrors, barcodes]
    );

    return (
      <div className={tw("w-full", className)} style={style}>
        {barcodes.map((barcode, i) => {
          const valueErrorMessage = touchedFields.has(i)
            ? validationErrors[i]
            : undefined;

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
                  <input
                    type="hidden"
                    name={typeName(i)}
                    value={barcode.type}
                  />
                  {/* Hidden ID field for existing barcodes */}
                  <When truthy={Boolean(idName) && Boolean(barcode.id)}>
                    <input type="hidden" name={idName!(i)} value={barcode.id} />
                  </When>
                </div>

                {/* Barcode Value Input */}
                <div className="flex-[2]">
                  <Input
                    label="Barcode Value"
                    hideLabel
                    disabled={disabled}
                    name={valueName(i)}
                    value={barcode.value}
                    placeholder="Enter barcode value"
                    onChange={(e) => {
                      barcodes[i].value = e.target.value.toUpperCase();
                      setBarcodes([...barcodes]);
                    }}
                    onBlur={() => {
                      setTouchedFields((prev) => new Set(prev).add(i));
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
                  disabled={disabled}
                  onClick={() => {
                    barcodes.splice(i, 1);
                    setBarcodes([...barcodes]);

                    // Clean up touched fields - shift indices down for items after the removed one
                    setTouchedFields((prev) => {
                      const newTouched = new Set<number>();
                      prev.forEach((index) => {
                        if (index < i) {
                          newTouched.add(index);
                        } else if (index > i) {
                          newTouched.add(index - 1);
                        }
                        // Skip index === i (the removed item)
                      });
                      return newTouched;
                    });
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
          {barcodes.length === 0 ? "Add barcode" : "Add another barcode"}
        </Button>
      </div>
    );
  }
);

export default BarcodesInput;
