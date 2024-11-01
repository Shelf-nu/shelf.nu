import { useZorm } from "react-zorm";
import { z } from "zod";
import type { Filter } from "./schema";

/**
 * Schema for validating individual filter values based on their type
 */
const filterValueSchema = {
  string: z.string().min(1, "Value is required"),
  text: z.string().min(1, "Value is required"),
  enum: z.string().min(1, "Please select a value"),
  date: z.union([
    z.string().min(1, "Date is required"),
    z.array(z.string()).refine(
      (dates) => {
        if (dates.length !== 2) return true;
        return new Date(dates[0]) <= new Date(dates[1]);
      },
      { message: "Start date must be before or equal to end date" }
    ),
  ]),
  number: z.union([
    z.number().min(0, "Number is required"),
    z.array(z.number()).refine(
      (numbers) => {
        if (numbers.length !== 2) return true;
        return numbers[0] <= numbers[1];
      },
      { message: "Start value must be less than or equal to end value" }
    ),
  ]),
  boolean: z.boolean(),
  array: z.array(z.string()).min(1, "Please select at least one value"),
};

/**
 * Hook for managing filter form validation
 * @param filters - Current filters array
 * @param initialFilters - Initial filters for comparison
 * @returns Validation state and helper methods
 */
export function useFilterFormValidation(
  filters: Filter[],
  initialFilters: Filter[]
) {
  // Generate dynamic schema based on current filters
  const FormSchema = z.object({
    filters: z
      .array(
        z.object({
          name: z.string(),
          value: z.any(), // Use a specific schema if possible
        })
      )
      .min(1, "At least one filter is required"),
  });

  const zo = useZorm("filterForm", FormSchema);

  /**
   * Validates a single filter value based on its type and operator
   * @param filter - Filter to validate
   * @returns True if valid, false if invalid
   */
  const validateFilterValue = (filter: Filter): boolean => {
    try {
      const schema =
        filterValueSchema[filter.type as keyof typeof filterValueSchema];
      if (!schema) return true; // Skip validation for unsupported types

      schema.parse(filter.value);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Checks if filters can be applied
   * @returns Object containing validation state
   */
  const getValidationState = () => {
    const hasInvalidFilters = filters.some(
      (filter) => !validateFilterValue(filter)
    );
    const haveFiltersChanged =
      JSON.stringify(initialFilters) !== JSON.stringify(filters);

    return {
      isValid: !hasInvalidFilters,
      canApplyFilters: !hasInvalidFilters && haveFiltersChanged,
      hasChanges: haveFiltersChanged,
    };
  };

  /**
   * Gets field name for zorm validation
   * @param filterIndex - Index of filter in array
   * @returns Zorm field name
   */
  // Usage in the hook
  const getFieldName = (filterIndex: number) => `filters.${filterIndex}.value`;

  /**
   * Gets error message for a specific filter
   * @param filterIndex - Index of filter in array
   * @returns Error message if any, or null if no error
   */
  const getError = (filterIndex: number) => {
    const error = (zo.errors?.filters as any)?.[filterIndex]?.value;
    return error?.message && typeof error.message === "string"
      ? error.message
      : null;
  };

  return {
    zo,
    getValidationState,
    getFieldName,
    getError,
  };
}
