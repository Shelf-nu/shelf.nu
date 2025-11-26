import {
  useState,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useEffect,
} from "react";
import { BarcodeType } from "@prisma/client";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { useActionData } from "react-router";
import { ChevronRight, HelpIcon } from "~/components/icons/library";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { BARCODE_TYPE_OPTIONS } from "~/modules/barcode/constants";
import {
  validateBarcodeValue,
  normalizeBarcodeValue,
} from "~/modules/barcode/validation";
import { getValidationErrors } from "~/utils/http";
import { tw } from "~/utils/tw";
import Input from "./input";
import { Button } from "../shared/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";
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

const BarcodeTypeTooltip = ({ type }: { type: BarcodeType }) => {
  const option = BARCODE_TYPE_OPTIONS.find((opt) => opt.value === type);

  if (!option) return null;

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <i className="absolute right-3 top-1/2 flex -translate-y-1/2 cursor-pointer text-gray-400 hover:text-gray-700">
            <HelpIcon />
          </i>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="max-w-[260px] sm:max-w-[320px]">
            <h6 className="mb-1 text-xs font-semibold text-gray-700">
              {option.label}
            </h6>
            <p className="text-xs font-medium text-gray-500">
              {option.description}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

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
    const [clearedServerErrors, setClearedServerErrors] = useState<Set<number>>(
      new Set()
    );
    const { isMd } = useViewportHeight();

    // Get server-side validation errors from action data
    const actionData = useActionData<{ error?: any }>();
    const serverValidationErrors = getValidationErrors(actionData?.error);

    // Reset cleared server errors when we get new action data (e.g., after form submission)
    useEffect(() => {
      if (actionData?.error) {
        setClearedServerErrors(new Set());
      }
    }, [actionData]);

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

        // Check for duplicates (normalize values for comparison)
        const normalizedValue = normalizeBarcodeValue(
          barcode.type,
          barcode.value
        );
        if (values.has(normalizedValue)) {
          errors[index] = "Duplicate barcode values are not allowed";
          return;
        }

        values.add(normalizedValue);
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

    const RemoveButton = ({ i }: { i: number }) => (
      <Button
        icon="x"
        className="h-[42px] py-2"
        variant="secondary"
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

          // Clean up cleared server errors - shift indices down for items after the removed one
          setClearedServerErrors((prev) => {
            const newCleared = new Set<number>();
            prev.forEach((index) => {
              if (index < i) {
                newCleared.add(index);
              } else if (index > i) {
                newCleared.add(index - 1);
              }
              // Skip index === i (the removed item)
            });
            return newCleared;
          });
        }}
      />
    );

    return (
      <div className={tw("w-full", className)} style={style}>
        <div className=" border-t py-5 md:hidden">
          <h2 className="mb-1 text-[18px] font-semibold">Barcodes</h2>
        </div>
        {barcodes.map((barcode, i) => {
          // Show server errors first (unless cleared), then client-side validation errors
          const serverError = !clearedServerErrors.has(i)
            ? serverValidationErrors?.[`barcodes[${i}].value`]?.message
            : undefined;
          const clientError = touchedFields.has(i)
            ? validationErrors[i]
            : undefined;
          const valueErrorMessage = serverError || clientError;

          return (
            <div key={i} className="mb-3">
              <div className="flex flex-col items-start gap-2 md:flex-row">
                {/* Barcode Type Select */}
                <div className=" flex w-full items-end gap-2 md:w-auto md:flex-1 md:items-start">
                  <Popover>
                    <PopoverTrigger asChild>
                      <div className="w-full">
                        <p className="inner-label mb-[6px] font-medium text-gray-700 lg:hidden">
                          Select barcode type
                        </p>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={disabled}
                          className="relative h-auto w-full justify-start truncate whitespace-nowrap px-[14px] py-2 pr-10 text-text-md font-normal [&_span]:max-w-full [&_span]:truncate"
                        >
                          <ChevronRight className="ml-[2px] inline-block rotate-90 text-sm" />
                          <span className="ml-2 text-text-md">
                            {BARCODE_TYPE_OPTIONS.find(
                              (opt) => opt.value === barcode.type
                            )?.label || "Select barcode type"}
                          </span>
                          <BarcodeTypeTooltip type={barcode.type} />
                        </Button>
                      </div>
                    </PopoverTrigger>
                    <PopoverPortal>
                      <PopoverContent
                        align="start"
                        className={tw(
                          "z-[999999] mt-2 max-h-[400px]  max-w-[300px] rounded-md border border-gray-200 bg-white md:max-w-none"
                        )}
                      >
                        {BARCODE_TYPE_OPTIONS.map((option) => (
                          <div
                            key={option.value}
                            className={tw(
                              "px-4 py-3 hover:cursor-pointer hover:bg-gray-50",
                              barcode.type === option.value &&
                                "bg-gray-50 font-medium"
                            )}
                            onClick={() => {
                              barcodes[i].type = option.value as BarcodeType;
                              setBarcodes([...barcodes]);
                            }}
                          >
                            <div className="font-medium text-gray-900">
                              {option.label}
                            </div>
                            <div className="mt-1 text-sm text-gray-500">
                              {option.description}
                            </div>
                          </div>
                        ))}
                      </PopoverContent>
                    </PopoverPortal>
                  </Popover>
                  {/* Remove small screen button */}
                  <When truthy={!isMd}>
                    <RemoveButton i={i} />
                  </When>
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
                <div className="w-full md:w-auto md:flex-[2]">
                  <Input
                    label="Barcode Value"
                    hideLabel
                    disabled={disabled}
                    name={valueName(i)}
                    value={barcode.value}
                    placeholder="Enter barcode value"
                    onChange={(e) => {
                      barcodes[i].value = normalizeBarcodeValue(
                        barcodes[i].type,
                        e.target.value
                      );
                      setBarcodes([...barcodes]);

                      // Clear server error for this field when user starts typing
                      setClearedServerErrors((prev) => new Set(prev).add(i));
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

                {/* Remove Button Desktop */}
                <When truthy={isMd}>
                  <RemoveButton i={i} />
                </When>
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
