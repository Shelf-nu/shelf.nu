import { useState, useEffect } from "react";
import { BarcodeType } from "@prisma/client";
import { useFetcher } from "@remix-run/react";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import { validateBarcodeValue } from "~/modules/barcode/validation";
import Input from "../forms/input";

interface AddBarcodeFormProps {
  onCancel: () => void;
  onSuccess: () => void;
  action: string; // The route to submit to (e.g., "/assets/123" or "/kits/456")
  onRefetchData?: () => void; // Callback to refetch data after successful submission
}

export function AddBarcodeForm({
  onCancel,
  onSuccess,
  action,
  onRefetchData,
}: AddBarcodeFormProps) {
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const disabled = useDisabled(fetcher);
  const [barcodeType, setBarcodeType] = useState<BarcodeType>(
    BarcodeType.Code128
  );
  const [barcodeValue, setBarcodeValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Validate barcode value when it changes
  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase();
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
      const error = validateBarcodeValue(type, barcodeValue);
      setValidationError(error);
    }
  };

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

  return (
    <fetcher.Form method="post" action={action} className="space-y-4">
      <input type="hidden" name="intent" value="add-barcode" />
      <input type="hidden" name="barcodeType" value={barcodeType} />
      <input type="hidden" name="barcodeValue" value={barcodeValue} />

      {/* Barcode Type Selector */}
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
          <option value={BarcodeType.Code128}>Code128 (4-40 characters)</option>
          <option value={BarcodeType.Code39}>
            Code39 (exactly 6 characters)
          </option>
          <option value={BarcodeType.DataMatrix}>
            DataMatrix (4-100 characters)
          </option>
        </select>
      </div>

      {/* Barcode Value Input */}
      <Input
        label="Barcode Value"
        value={barcodeValue}
        onChange={handleValueChange}
        error={validationError || fetcher.data?.error}
        disabled={disabled}
        placeholder="Enter barcode value"
        required
      />

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
