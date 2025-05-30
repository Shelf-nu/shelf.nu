import { useState } from "react";
import { useFetcher } from "@remix-run/react";
import { useZorm } from "react-zorm";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { Switch } from "~/components/forms/switch";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import { useDisabled } from "~/hooks/use-disabled";
import { WorkingHoursOverrideSchema } from "~/modules/working-hours/zod-utils";
import type { ActionData } from "~/routes/_layout+/settings.working-hours";

export function NewOverrideDialog() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const disabled = useDisabled();

  function handleOpenDialog() {
    setIsDialogOpen(true);
  }

  function handleCloseDialog() {
    setIsDialogOpen(false);
  }
  const handleOverrideSuccess = () => {
    // Close dialog on successful creation
    setIsDialogOpen(false);
  };

  return (
    <>
      <Button
        variant="secondary"
        onClick={handleOpenDialog}
        disabled={disabled}
        icon="plus"
      >
        Add override
      </Button>
      <DialogPortal>
        <Dialog
          open={isDialogOpen}
          onClose={handleCloseDialog}
          headerClassName="border-b"
          title={
            <div className="-mb-3 w-full pb-6">
              <h3>Create new override</h3>
              <p className="text-gray-600">
                Create a new date override for your working hours.
              </p>
            </div>
          }
          className="[&_.dialog-header>button]:mt-1"
        >
          <div className="px-6 pb-4">
            <WorkingHoursOverrideForm
              onSuccess={handleOverrideSuccess}
              onCancel={handleCloseDialog}
            />
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}

interface WorkingHoursOverrideFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export const WorkingHoursOverrideForm = ({
  onSuccess,
  onCancel,
}: WorkingHoursOverrideFormProps) => {
  const fetcher = useFetcher<ActionData>({ key: "workingHoursOverride" });
  const disabled = useDisabled(fetcher);
  const zo = useZorm("WorkingHoursOverrideForm", WorkingHoursOverrideSchema);

  // Local state for form fields
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [date, setDate] = useState<string>("");
  const [openTime, setOpenTime] = useState<string>("09:00");
  const [closeTime, setCloseTime] = useState<string>("17:00");
  const [reason, setReason] = useState<string>("");

  // Track validation errors locally for better UX
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  const handleIsOpenChange = (checked: boolean) => {
    setIsOpen(checked);
    // Clear time-related validation errors when toggling off
    if (!checked) {
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.openTime;
        delete newErrors.closeTime;
        return newErrors;
      });
    }
  };

  const handleInputChange = (field: string, value: string) => {
    // Clear validation error for this field
    setValidationErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[field];
      return newErrors;
    });

    // Update local state
    switch (field) {
      case "date":
        setDate(value);
        break;
      case "openTime":
        setOpenTime(value);
        break;
      case "closeTime":
        setCloseTime(value);
        break;
      case "reason":
        setReason(value);
        break;
    }
  };

  const validateForm = (): boolean => {
    const formData = {
      isOpen: isOpen ? "on" : "off",
      date,
      openTime: isOpen ? openTime : undefined,
      closeTime: isOpen ? closeTime : undefined,
      reason,
    };

    const validation = WorkingHoursOverrideSchema.safeParse(formData);

    if (!validation.success) {
      const errors: Record<string, string> = {};
      validation.error.errors.forEach((error) => {
        const field = error.path.join(".");
        errors[field] = error.message;
      });
      setValidationErrors(errors);
      return false;
    }

    setValidationErrors({});
    return true;
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (validateForm()) {
      fetcher.submit(event.currentTarget);
    }
  };

  // Handle successful submission
  if (
    fetcher.state === "idle" &&
    fetcher.data &&
    "success" in fetcher.data &&
    fetcher.data.success &&
    onSuccess
  ) {
    onSuccess();
  }

  return (
    <div className="">
      <fetcher.Form
        ref={zo.ref}
        method="post"
        className=""
        onSubmit={handleSubmit}
        noValidate
      >
        <input type="hidden" name="intent" value="createOverride" />

        {/* Override Open/Closed Toggle */}
        <FormRow
          rowLabel="Override Status"
          subHeading="Choose whether this date should be open or closed"
          className="border-b pb-4"
        >
          <div className="flex items-center gap-3">
            <Switch
              name={zo.fields.isOpen()}
              id="override-is-open"
              disabled={disabled}
              checked={isOpen}
              onCheckedChange={handleIsOpenChange}
              title="Toggle override status"
            />
            <label htmlFor="override-is-open" className="text-sm font-medium">
              Open
            </label>
          </div>
          {validationErrors.isOpen && (
            <div className="mt-1 text-sm text-error-500">
              {validationErrors.isOpen}
            </div>
          )}
        </FormRow>

        {/* Date Field */}
        <FormRow
          rowLabel="Date"
          subHeading="Select the date for this override"
          className="w-full border-b pb-4"
          required
        >
          <Input
            label="Override Date"
            hideLabel
            type="date"
            name={zo.fields.date()}
            value={date}
            onChange={(e) => handleInputChange("date", e.target.value)}
            disabled={disabled}
            required
            min={new Date().toISOString().split("T")[0]} // Prevent past dates
            error={validationErrors.date}
            className="w-full"
          />
        </FormRow>

        {/* Time Fields - Only show when isOpen is true */}
        {isOpen && (
          <FormRow
            rowLabel="Operating Hours"
            subHeading="Set the open and close times for this date"
            className="border-b pb-4"
            required
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Input
                  label="Open Time"
                  hideLabel
                  type="time"
                  name={zo.fields.openTime()}
                  value={openTime}
                  onChange={(e) =>
                    handleInputChange("openTime", e.target.value)
                  }
                  disabled={disabled}
                  required={isOpen}
                  placeholder="09:00"
                />
                <div className="text-gray-500">-</div>
                <Input
                  label="Close Time"
                  hideLabel
                  type="time"
                  name={zo.fields.closeTime()}
                  value={closeTime}
                  onChange={(e) =>
                    handleInputChange("closeTime", e.target.value)
                  }
                  disabled={disabled}
                  required={isOpen}
                  placeholder="17:00"
                />
              </div>
              {(validationErrors.openTime || validationErrors.closeTime) && (
                <div className="text-sm text-error-500">
                  {validationErrors.openTime || validationErrors.closeTime}
                </div>
              )}
            </div>
          </FormRow>
        )}

        {/* Reason Field */}
        <FormRow
          rowLabel="Reason"
          subHeading="Provide a reason for this override (e.g., Holiday, Maintenance, etc.)"
          className="border-b pb-4"
          required
        >
          <Input
            label="Reason for Override"
            hideLabel
            type="text"
            name={zo.fields.reason()}
            value={reason}
            onChange={(e) => handleInputChange("reason", e.target.value)}
            disabled={disabled}
            required
            placeholder="e.g., Public Holiday, Staff Training, etc."
            maxLength={500}
            error={validationErrors.reason}
          />
        </FormRow>

        {/* Global validation errors */}
        {validationErrors.general && (
          <div className="rounded-md border border-error-200 bg-error-50 p-3">
            <p className="text-sm text-error-700">{validationErrors.general}</p>
          </div>
        )}

        {/* Form Actions */}
        <div className="flex justify-end gap-3 pt-4">
          {onCancel && (
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              disabled={disabled}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={disabled}>
            {disabled ? <Spinner /> : "Create override"}
          </Button>
        </div>
      </fetcher.Form>
    </div>
  );
};
