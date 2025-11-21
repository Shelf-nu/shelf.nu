import { useState } from "react";
import { useFetcher } from "react-router";
import { useDisabled } from "~/hooks/use-disabled";
import {
  DAY_NAMES,
  WEEK_DISPLAY_ORDER,
} from "~/modules/working-hours/constants";
import type { WeeklyScheduleJson } from "~/modules/working-hours/types";
import { Switch } from "../forms/switch";
import { TimeSelect } from "../forms/time-select";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { Spinner } from "../shared/spinner";

interface WeeklyScheduleFormProps {
  weeklySchedule: WeeklyScheduleJson;
  className?: string;
}

interface DayScheduleState {
  isOpen: boolean;
  openTime: string;
  closeTime: string;
}

type WeeklyScheduleState = {
  [K in keyof WeeklyScheduleJson]: DayScheduleState;
};

export const WeeklyScheduleForm = ({
  weeklySchedule,
}: WeeklyScheduleFormProps) => {
  const fetcher = useFetcher({ key: "weeklySchedule" });
  const disabled = useDisabled(fetcher);
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  // Initialize state from the provided weeklySchedule
  const [scheduleState, setScheduleState] = useState<WeeklyScheduleState>(
    () => {
      const initialState: Partial<WeeklyScheduleState> = {};

      WEEK_DISPLAY_ORDER.forEach((dayOfWeek) => {
        const dayNumber = dayOfWeek.toString() as keyof WeeklyScheduleJson;
        const daySchedule = weeklySchedule[dayNumber];

        initialState[dayNumber] = {
          isOpen: daySchedule?.isOpen || false,
          openTime: daySchedule?.openTime || "09:00",
          closeTime: daySchedule?.closeTime || "17:00",
        };
      });

      return initialState as WeeklyScheduleState;
    }
  );

  const handleDayToggle = (dayNumber: string, isOpen: boolean) => {
    setScheduleState((prev) => ({
      ...prev,
      [dayNumber]: {
        ...prev[dayNumber as keyof WeeklyScheduleState],
        isOpen,
      },
    }));

    // Clear validation errors when toggling
    if (!isOpen) {
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[`${dayNumber}`];
        return newErrors;
      });
    }
  };

  const handleTimeChange = (
    dayNumber: string,
    timeType: "openTime" | "closeTime",
    value: string
  ) => {
    setScheduleState((prev) => ({
      ...prev,
      [dayNumber]: {
        ...prev[dayNumber as keyof WeeklyScheduleState],
        [timeType]: value,
      },
    }));

    // Clear specific validation error
    setValidationErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[`${dayNumber}`];
      return newErrors;
    });
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    let hasOpenDay = false;

    WEEK_DISPLAY_ORDER.forEach((dayOfWeek) => {
      const dayNumber = dayOfWeek.toString();
      const dayState = scheduleState[dayNumber as keyof WeeklyScheduleState];

      if (dayState.isOpen) {
        hasOpenDay = true;

        // Validate open time
        if (!dayState.openTime) {
          errors[`${dayNumber}`] = "Open time is required";
        }

        // Validate close time
        if (!dayState.closeTime) {
          errors[`${dayNumber}`] = "Close time is required";
        }

        // Validate time logic
        if (dayState.openTime && dayState.closeTime) {
          const [openHours, openMinutes] = dayState.openTime
            .split(":")
            .map(Number);
          const [closeHours, closeMinutes] = dayState.closeTime
            .split(":")
            .map(Number);

          const openTotalMinutes = openHours * 60 + openMinutes;
          const closeTotalMinutes = closeHours * 60 + closeMinutes;

          if (openTotalMinutes >= closeTotalMinutes) {
            errors[`${dayNumber}`] = "Close time must be after open time";
          }
        }
      }
    });

    // Check if at least one day is open
    if (!hasOpenDay) {
      errors.general = "At least one day must be marked as open";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (validateForm()) {
      fetcher.submit(event.currentTarget);
    }
  };

  return (
    <Card>
      <fetcher.Form
        method="post"
        className="flex flex-col gap-2"
        onSubmit={handleSubmit}
        noValidate
      >
        <input type="hidden" name="intent" value="updateSchedule" />
        <div className="mb-4 border-b pb-4">
          <h3 className="text-text-lg font-semibold">Weekly Schedule</h3>
          <p className="text-sm text-gray-600">
            Set your working hours for each day of the week. Times will be
            displayed in your local format.
          </p>

          {validationErrors.general && (
            <p className="mt-2 text-sm text-red-600">
              {validationErrors.general}
            </p>
          )}
        </div>

        <div className="space-y-4">
          {WEEK_DISPLAY_ORDER.map((dayOfWeek) => {
            const dayNumber = dayOfWeek.toString();
            const dayState =
              scheduleState[dayNumber as keyof WeeklyScheduleState];
            const dayName = DAY_NAMES[dayOfWeek];

            return (
              <div key={dayName} className="flex items-center gap-4">
                <div className="flex h-[42px] min-w-[280px] items-center gap-3">
                  <Switch
                    name={`${dayNumber}.isOpen`}
                    id={`day-${dayNumber}-enabled`}
                    disabled={disabled}
                    defaultChecked={dayState.isOpen}
                    onCheckedChange={(checked) =>
                      handleDayToggle(dayNumber, checked)
                    }
                  />
                  <label
                    htmlFor={`day-${dayNumber}-enabled`}
                    className="font-medium"
                  >
                    {dayName}
                  </label>
                </div>
                <div className="flex items-center gap-4">
                  {/* Time Inputs - Show when day is open */}
                  {dayState.isOpen && (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-3">
                        <TimeSelect
                          name={`${dayNumber}.openTime`}
                          value={dayState.openTime}
                          onValueChange={(time) =>
                            handleTimeChange(dayNumber, "openTime", time)
                          }
                          disabled={disabled}
                          placeholder="Select opening time"
                          aria-label={`${dayName} opening time`}
                          required={dayState.isOpen}
                        />
                        <div> - </div>
                        <TimeSelect
                          name={`${dayNumber}.closeTime`}
                          value={dayState.closeTime}
                          onValueChange={(time) =>
                            handleTimeChange(dayNumber, "closeTime", time)
                          }
                          disabled={disabled}
                          placeholder="Select closing time"
                          aria-label={`${dayName} closing time`}
                          required={dayState.isOpen}
                        />
                      </div>
                      {validationErrors[`${dayNumber}`] && (
                        <div className="text-sm text-error-500">
                          {validationErrors[`${dayNumber}`]}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Hidden inputs to ensure form data is captured correctly */}
                  <input
                    type="hidden"
                    name={`${dayNumber}.isOpen`}
                    value={dayState.isOpen ? "on" : "off"}
                  />
                  {!dayState.isOpen && (
                    <>
                      <input
                        type="hidden"
                        name={`${dayNumber}.openTime`}
                        value=""
                      />
                      <input
                        type="hidden"
                        name={`${dayNumber}.closeTime`}
                        value=""
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 text-right">
          <Button type="submit" disabled={disabled}>
            {disabled ? <Spinner /> : "Save Schedule"}
          </Button>
        </div>
      </fetcher.Form>
    </Card>
  );
};
