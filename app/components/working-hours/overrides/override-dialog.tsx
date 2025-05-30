import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { useZorm } from "react-zorm";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { Switch } from "~/components/forms/switch";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import When from "~/components/when/when";
import { useDisabled } from "~/hooks/use-disabled";
import { CreateOverrideSchema } from "~/modules/working-hours/zod-utils";
import type { ActionData } from "~/routes/_layout+/settings.working-hours";
import { useHints } from "~/utils/client-hints";
import {
  adjustDateToUserTimezone,
  adjustDateToUTC,
  getTodayInUserTimezone,
} from "~/utils/date-fns";

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
  // For editing existing overrides
  initialData?: {
    id: string;
    isOpen: boolean;
    date: string; // UTC date from database
    openTime?: string;
    closeTime?: string;
    reason: string;
  };
}

export const WorkingHoursOverrideForm = ({
  onSuccess,
  onCancel,
  initialData,
}: WorkingHoursOverrideFormProps) => {
  const fetcher = useFetcher<ActionData>({ key: "workingHoursOverride" });
  const disabled = useDisabled(fetcher);
  const zo = useZorm("WorkingHoursOverrideForm", CreateOverrideSchema);
  const { timeZone } = useHints();

  // Convert initial data from UTC to user timezone for display
  const initialLocalDate = useMemo(() => {
    if (initialData?.date) {
      return adjustDateToUserTimezone(initialData.date, timeZone);
    }
    return "";
  }, [initialData?.date, timeZone]);

  // Local state for form fields (all in user's timezone)
  const [isOpen, setIsOpen] = useState<boolean>(initialData?.isOpen ?? false);
  const [localDate, setLocalDate] = useState<string>(initialLocalDate);
  const [openTime, setOpenTime] = useState<string>(
    initialData?.openTime ?? "09:00"
  );
  const [closeTime, setCloseTime] = useState<string>(
    initialData?.closeTime ?? "17:00"
  );
  const [reason, setReason] = useState<string>(initialData?.reason ?? "");

  // Track validation errors locally for better UX
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  // Get today's date in user timezone for minimum date validation
  const todayInUserTimezone = useMemo(
    () => getTodayInUserTimezone(timeZone),
    [timeZone]
  );

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
        setLocalDate(value);
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
    const errors: Record<string, string> = {};

    // Validate date is not in the past (in user's timezone)
    if (localDate && localDate < todayInUserTimezone) {
      errors.date = "Date must be today or in the future";
    }

    // Convert to UTC for backend validation
    const utcDate = localDate ? adjustDateToUTC(localDate, timeZone) : "";

    const formData = {
      isOpen: isOpen ? "on" : "off",
      date: utcDate,
      openTime: isOpen ? openTime : undefined,
      closeTime: isOpen ? closeTime : undefined,
      reason,
    };

    const validation = CreateOverrideSchema.safeParse(formData);

    if (!validation.success) {
      validation.error.errors.forEach((error) => {
        const field = error.path.join(".");
        errors[field] = error.message;
      });
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (validateForm()) {
      // Create a new FormData with UTC date for submission
      const formData = new FormData(event.currentTarget);
      const utcDate = adjustDateToUTC(localDate, timeZone);

      // Replace the local date with UTC date
      formData.set("date", utcDate);

      fetcher.submit(formData, {
        method: "post",
      });
    }
  };

  // Handle successful submission
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      "success" in fetcher.data &&
      fetcher.data.success &&
      onSuccess
    ) {
      onSuccess();
    }
  }, [fetcher.state, fetcher.data, onSuccess]);

  return (
    <div className="">
      <fetcher.Form
        ref={zo.ref}
        method="post"
        className=""
        onSubmit={handleSubmit}
        noValidate
      >
        <input
          type="hidden"
          name="intent"
          value={initialData ? "updateOverride" : "createOverride"}
        />
        {initialData && (
          <input type="hidden" name="overrideId" value={initialData.id} />
        )}

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
              value={isOpen ? "on" : "off"}
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
          className="border-b pb-4"
          required
        >
          <Input
            label="Override Date"
            hideLabel
            type="date"
            name="date" // Will be replaced with UTC date on submit
            value={localDate}
            onChange={(e) => handleInputChange("date", e.target.value)}
            disabled={disabled}
            required
            min={todayInUserTimezone}
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
        <div className="mt-4 flex justify-between gap-3">
          <When truthy={!!fetcher?.data?.error}>
            <p className="text-sm text-error-500">
              {fetcher.data?.error?.message}
            </p>
          </When>
          <div className="ml-auto flex items-center gap-2">
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
            <Button
              type="submit"
              disabled={disabled}
              className={"whitespace-nowrap"}
            >
              {disabled ? (
                <Spinner />
              ) : initialData ? (
                "Update Override"
              ) : (
                "Create Override"
              )}
            </Button>
          </div>
        </div>
      </fetcher.Form>
    </div>
  );
};
