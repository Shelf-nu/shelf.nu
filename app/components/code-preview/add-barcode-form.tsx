import { useState, useEffect, useMemo } from "react";
import { BarcodeType } from "@prisma/client";
import { useFetcher } from "react-router";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import { BARCODE_TYPE_OPTIONS } from "~/modules/barcode/constants";
import {
  validateBarcodeValue,
  normalizeBarcodeValue,
} from "~/modules/barcode/validation";
import Input from "../forms/input";

interface AddBarcodeFormProps {
  onCancel: () => void;
  onSuccess: () => void;
  action: string; // The route to submit to (e.g., "/assets/123" or "/kits/456")
  onRefetchData?: () => void; // Callback to refetch data after successful submission
  // For scan mode - hide fields and use predetermined values
  hideFields?: boolean;
  initialBarcodeType?: BarcodeType;
  initialBarcodeValue?: string;
}

export function AddBarcodeForm({
  onCancel,
  onSuccess,
  action,
  onRefetchData,
  hideFields = false,
  initialBarcodeType = BarcodeType.Code128,
  initialBarcodeValue = "",
}: AddBarcodeFormProps) {
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const disabled = useDisabled(fetcher);
  const [barcodeType, setBarcodeType] =
    useState<BarcodeType>(initialBarcodeType);
  const [barcodeValue, setBarcodeValue] = useState(initialBarcodeValue);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Validate barcode value when it changes
  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Normalize value based on barcode type (preserves case for URLs)
    const value = normalizeBarcodeValue(barcodeType, e.target.value);
    setBarcodeValue(value);

    if (value) {
      const error = validateBarcodeValue(barcodeType, value);
      setValidationError(error);
    } else {
      setValidationError(null);
    }
  };

  // Validate when barcode type changes
  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const type = e.target.value as BarcodeType;
    setBarcodeType(type);

    if (barcodeValue) {
      // Adjust value case based on new type
      const adjustedValue = normalizeBarcodeValue(type, barcodeValue);
      setBarcodeValue(adjustedValue);

      const error = validateBarcodeValue(type, adjustedValue);
      setValidationError(error);
    }
  };

  // Initial validation for hideFields mode
  useEffect(() => {
    if (hideFields && initialBarcodeValue) {
      const error = validateBarcodeValue(
        initialBarcodeType,
        initialBarcodeValue
      );
      setValidationError(error);
    }
  }, [hideFields, initialBarcodeType, initialBarcodeValue]);

  // Handle successful submission
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      "success" in fetcher.data &&
      fetcher.data.success
    ) {
      onRefetchData?.(); // Trigger data refetch if callback is provided
      onSuccess();
    }
  }, [fetcher.state, fetcher.data, onRefetchData, onSuccess]);

  const helpText = useMemo(() => {
    const option = BARCODE_TYPE_OPTIONS.find(
      (opt) => opt.value === barcodeType
    );
    return option ? option.description : undefined;
  }, [barcodeType]);

  return (
    <fetcher.Form method="post" action={action} className="space-y-4">
      <input type="hidden" name="intent" value="add-barcode" />
      <input type="hidden" name="barcodeType" value={barcodeType} />
      <input type="hidden" name="barcodeValue" value={barcodeValue} />

      {/* Barcode Type Selector */}
      {!hideFields && (
        <div>
          <label
            htmlFor="barcodeType"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Barcode Type
          </label>
          <select
            id="barcodeType"
            value={barcodeType}
            onChange={handleTypeChange}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={disabled}
            required
          >
            {BARCODE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-gray-600">{helpText}</p>
        </div>
      )}

      {/* Barcode Value Input */}
      {!hideFields && (
        <Input
          label="Barcode Value"
          value={barcodeValue}
          onChange={handleValueChange}
          error={validationError || fetcher.data?.error}
          disabled={disabled}
          placeholder="Enter barcode value"
          required
        />
      )}

      {/* Show validation error even when fields are hidden */}
      {hideFields && (validationError || fetcher.data?.error) && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-600">
            {validationError || fetcher.data?.error}
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-3 pt-4">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={disabled}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={disabled || !!validationError || !barcodeValue.trim()}
          loading={fetcher.state === "submitting"}
        >
          Add Barcode
        </Button>
      </div>
    </fetcher.Form>
  );
}
