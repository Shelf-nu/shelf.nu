import type {
  Asset,
  AssetStatus,
  Location,
  Prisma,
  CustomFieldType,
} from "@prisma/client";
import _ from "lodash";
import { z } from "zod";
import { filterOperatorSchema } from "~/components/assets/assets-index/advanced-filters/schema";
import { getCustomFieldDisplayValue } from "~/utils/custom-fields";
import { getParamsValues } from "~/utils/list";
import { wrapUserLinkForNote, wrapLinkForNote } from "~/utils/markdoc-wrappers";
import { parseFiltersWithHierarchy } from "./query.server";
import type { ICustomFieldValueJson } from "./types";
import type { Column } from "../asset-index-settings/helpers";

export function getLocationUpdateNoteContent({
  currentLocation,
  newLocation,
  userId,
  firstName,
  lastName,

  isRemoving,
}: {
  currentLocation?: Pick<Location, "id" | "name"> | null;
  newLocation?: Pick<Location, "id" | "name"> | null;
  userId: string;
  firstName: string;
  lastName: string;
  isRemoving?: boolean;
}) {
  const userLink = wrapUserLinkForNote({
    id: userId,
    firstName,
    lastName,
  });

  let message = "";
  if (currentLocation && newLocation) {
    const currentLocationLink = wrapLinkForNote(
      `/locations/${currentLocation.id}`,
      currentLocation.name.trim()
    );
    const newLocationLink = wrapLinkForNote(
      `/locations/${newLocation.id}`,
      newLocation.name.trim()
    );
    message = `${userLink} updated the location from ${currentLocationLink} to ${newLocationLink}.`; // updating location
  }

  if (newLocation && !currentLocation) {
    const newLocationLink = wrapLinkForNote(
      `/locations/${newLocation.id}`,
      newLocation.name.trim()
    );
    message = `${userLink} set the location to ${newLocationLink}.`; // setting to first location
  }

  if (isRemoving || !newLocation) {
    const currentLocationLink = wrapLinkForNote(
      `/locations/${currentLocation?.id}`,
      currentLocation?.name.trim() || ""
    );
    message = `${userLink} removed the asset from location ${currentLocationLink}.`; // removing location
  }

  return message;
}

/**
 * Generates a markdown-formatted note content for custom field changes.
 *
 * @param params - The parameters for generating the note content
 * @param params.customFieldName - Name of the custom field that was changed
 * @param params.previousValue - Previous value of the field (null if first time set)
 * @param params.newValue - New value of the field (null if value was removed)
 * @param params.firstName - First name of the user making the change
 * @param params.lastName - Last name of the user making the change
 * @param params.assetName - Name of the asset being updated
 * @param params.isFirstTimeSet - Whether this is the first time a value is being set
 * @returns Markdown-formatted note content string, or empty string if invalid scenario
 *
 * @example
 * // First time setting a value
 * getCustomFieldUpdateNoteContent({
 *   customFieldName: "Serial Number",
 *   previousValue: null,
 *   newValue: "SN123456",
 *   firstName: "John",
 *   lastName: "Doe",
 *   isFirstTimeSet: true
 * })
 * // Returns: "**John Doe** set **Serial Number** of **Laptop** to **SN123456**"
 *
 * // Updating existing value
 * getCustomFieldUpdateNoteContent({
 *   customFieldName: "Status",
 *   previousValue: "Active",
 *   newValue: "Inactive",
 *   firstName: "Jane",
 *   lastName: "Smith",
 *   isFirstTimeSet: false
 * })
 * // Returns: "**Jane Smith** updated **Status** of **Camera** from **Active** to **Inactive**"
 */
export function getCustomFieldUpdateNoteContent({
  customFieldName,
  previousValue,
  newValue,
  userId,
  firstName,
  lastName,
  isFirstTimeSet,
}: {
  customFieldName: string;
  previousValue?: string | null;
  newValue?: string | null;
  userId: string;
  firstName: string;
  lastName: string;
  isFirstTimeSet: boolean;
}) {
  const userLink = wrapUserLinkForNote({
    id: userId,
    firstName,
    lastName,
  });
  let message = "";

  if (isFirstTimeSet && newValue) {
    // First time setting a value
    message = `${userLink} set **${customFieldName}** to **${newValue}**.`;
  } else if (previousValue && newValue) {
    // Changing from one value to another
    message = `${userLink} updated **${customFieldName}** from **${previousValue}** to **${newValue}**.`;
  } else if (previousValue && !newValue) {
    // Removing a value
    message = `${userLink} removed **${customFieldName}** value **${previousValue}**.`;
  }

  return message;
}

/**
 * Compares two custom field values to determine if they represent a meaningful change.
 * Uses type-specific comparison logic to handle different custom field types appropriately.
 *
 * @param oldValue - The previous custom field value
 * @param newValue - The new custom field value
 * @param fieldType - The type of the custom field (TEXT, DATE, BOOLEAN, etc.)
 * @returns true if the values represent a change, false if they are equivalent
 *
 * @example
 * // Date comparison
 * compareCustomFieldValues(
 *   { raw: "2024-01-15" },
 *   { raw: "2024-01-16" },
 *   "DATE"
 * ) // Returns: true
 *
 * // Boolean comparison with string normalization
 * compareCustomFieldValues(
 *   { raw: "true" },
 *   { raw: "false" },
 *   "BOOLEAN"
 * ) // Returns: true
 *
 * // Text comparison
 * compareCustomFieldValues(
 *   { raw: "old text" },
 *   { raw: "old text" },
 *   "TEXT"
 * ) // Returns: false
 */
export function compareCustomFieldValues(
  oldValue: ICustomFieldValueJson | null | undefined,
  newValue: ICustomFieldValueJson | null | undefined,
  fieldType: CustomFieldType
): boolean {
  // Handle null/undefined cases
  if (!oldValue && !newValue) return false; // No change
  if (!oldValue || !newValue) return true; // One is empty = change

  // Type-specific comparison
  switch (fieldType) {
    case "DATE":
      try {
        const oldTime = new Date(String(oldValue.raw)).getTime();
        const newTime = new Date(String(newValue.raw)).getTime();

        // Handle invalid dates (NaN values)
        if (isNaN(oldTime) || isNaN(newTime)) {
          // Fallback to string comparison if either date is invalid
          return String(oldValue.raw) !== String(newValue.raw);
        }

        return oldTime !== newTime;
      } catch {
        // Fallback to string comparison if date parsing fails
        return String(oldValue.raw) !== String(newValue.raw);
      }
    case "BOOLEAN": {
      // Handle string boolean values more intelligently
      const normalizeBoolean = (value: any) => {
        if (typeof value === "boolean") return value;
        if (typeof value === "string") {
          const lowerValue = value.toLowerCase().trim();
          if (lowerValue === "true" || lowerValue === "1") return true;
          if (lowerValue === "false" || lowerValue === "0" || lowerValue === "")
            return false;
        }
        return Boolean(value);
      };

      return normalizeBoolean(oldValue.raw) !== normalizeBoolean(newValue.raw);
    }
    case "NUMBER":
      return Number(oldValue.raw) !== Number(newValue.raw);
    default:
      // For text and other types, do deep comparison
      return JSON.stringify(oldValue) !== JSON.stringify(newValue);
  }
}

/**
 * Performs a quick scan to detect potential changes in custom field values.
 * This is an optimization function that uses basic comparison to avoid expensive
 * operations when no changes are detected.
 *
 * @param existingValues - Array of current custom field values with metadata
 * @param formValues - Array of new custom field values from form submission
 * @returns Array of field IDs that potentially have changes
 *
 * @example
 * const potentialChanges = detectPotentialChanges(
 *   [{ id: "1", customFieldId: "field1", value: { raw: "old" } }],
 *   [{ id: "field1", value: { raw: "new" } }]
 * )
 * // Returns: [{ fieldId: "field1", hasChange: true }]
 */
export function detectPotentialChanges(
  existingValues: Array<{
    id: string;
    customFieldId: string;
    value: ICustomFieldValueJson | null;
  }>,
  formValues: Array<{
    id: string;
    value: ICustomFieldValueJson | null;
  }>
): Array<{ fieldId: string; hasChange: boolean }> {
  const changes: Array<{ fieldId: string; hasChange: boolean }> = [];

  for (const formField of formValues) {
    const existingValue = existingValues.find(
      (cf) => cf.customFieldId === formField.id
    );

    // Quick check for potential changes
    let hasChange = false;

    if (!existingValue && formField.value) {
      // First time setting a value
      hasChange = true;
    } else if (existingValue && !formField.value) {
      // Removing a value
      hasChange = true;
    } else if (existingValue && formField.value) {
      // Basic comparison - if this suggests change, we'll do detailed comparison later
      const oldRaw = existingValue.value?.raw;
      const newRaw = formField.value?.raw;
      hasChange = oldRaw !== newRaw;
    }

    if (hasChange) {
      changes.push({ fieldId: formField.id, hasChange });
    }
  }

  return changes;
}

export interface CustomFieldChangeInfo {
  customFieldName: string;
  previousValue: string | null;
  newValue: string | null;
  isFirstTimeSet: boolean;
}

/**
 * Detects and analyzes changes in custom field values, returning detailed change information.
 * This function performs robust comparison using type-specific logic and formats values
 * for display using the same logic as the UI.
 *
 * @param existingValues - Current custom field values with field metadata
 * @param formValues - New custom field values from form submission
 * @param customFields - Custom field definitions for type information
 * @returns Array of change information objects with formatted display values
 *
 * @example
 * const changes = detectCustomFieldChanges(
 *   [{
 *     id: "1",
 *     customFieldId: "field1",
 *     value: { raw: "old" },
 *     customField: { id: "field1", name: "Status", type: "TEXT" }
 *   }],
 *   [{ id: "field1", value: { raw: "new" } }],
 *   [{ id: "field1", name: "Status", type: "TEXT" }]
 * )
 * // Returns: [{
 * //   customFieldName: "Status",
 * //   previousValue: "old",
 * //   newValue: "new",
 * //   isFirstTimeSet: false
 * // }]
 */
export function detectCustomFieldChanges(
  existingValues: Array<{
    id: string;
    customFieldId: string;
    value: ICustomFieldValueJson | null;
    customField: { id: string; name: string; type: CustomFieldType };
  }>,
  formValues: Array<{
    id: string;
    value: ICustomFieldValueJson | null;
  }>,
  customFields: Array<{
    id: string;
    name: string;
    type: CustomFieldType;
  }>
): CustomFieldChangeInfo[] {
  const changes: CustomFieldChangeInfo[] = [];

  // Create lookup map for performance
  const customFieldLookup = new Map(customFields.map((cf) => [cf.id, cf]));

  for (const formField of formValues) {
    const customField = customFieldLookup.get(formField.id);
    if (!customField) continue;

    const existingValue = existingValues.find(
      (cf) => cf.customFieldId === formField.id
    );

    // Format values for display using the same function as the UI
    const formatValue = (value: any) => {
      if (!value) return null;
      try {
        const displayValue = getCustomFieldDisplayValue(value);

        // Handle different return types from getCustomFieldDisplayValue
        if (typeof displayValue === "string") {
          return displayValue;
        } else if (displayValue && typeof displayValue === "object") {
          // For React nodes (multi-line text), use raw value
          return String(value.raw || "");
        }

        return String(displayValue);
      } catch {
        return String(value.raw || value);
      }
    };

    const newValueDisplay = formField.value
      ? formatValue(formField.value)
      : null;
    const oldValueDisplay = existingValue?.value
      ? formatValue(existingValue.value)
      : null;

    // Determine if this is a change worth noting using robust comparison
    let shouldCreateNote = false;
    let isFirstTimeSet = false;

    if (!existingValue && newValueDisplay) {
      // First time setting a value
      shouldCreateNote = true;
      isFirstTimeSet = true;
    } else if (existingValue && !newValueDisplay) {
      // Removing a value
      shouldCreateNote = true;
    } else if (existingValue && newValueDisplay) {
      // Use robust comparison
      shouldCreateNote = compareCustomFieldValues(
        existingValue.value,
        formField.value,
        customField.type
      );
    }

    if (shouldCreateNote) {
      changes.push({
        customFieldName: customField.name,
        previousValue: oldValueDisplay ? String(oldValueDisplay) : null,
        newValue: newValueDisplay ? String(newValueDisplay) : null,
        isFirstTimeSet,
      });
    }
  }

  return changes;
}

export function getKitLocationUpdateNoteContent({
  currentLocation,
  newLocation,
  userId,
  firstName,
  lastName,
  isRemoving,
}: {
  currentLocation?: Pick<Location, "id" | "name"> | null;
  newLocation?: Pick<Location, "id" | "name"> | null;
  userId: string;
  firstName: string;
  lastName: string;
  isRemoving?: boolean;
}) {
  const baseMessage = getLocationUpdateNoteContent({
    currentLocation,
    newLocation,
    userId,
    firstName,
    lastName,
    isRemoving,
  });

  if (isRemoving) {
    return `${baseMessage.replace(/\.$/, "")} via parent kit removal.`;
  } else {
    return `${baseMessage.replace(/\.$/, "")} via parent kit assignment.`;
  }
}

export const CurrentSearchParamsSchema = z.object({
  currentSearchParams: z.string().optional().nullable(),
});

export function getAssetsWhereInput({
  organizationId,
  currentSearchParams,
}: {
  organizationId: Asset["organizationId"];
  currentSearchParams?: string | null;
}) {
  const where: Prisma.AssetWhereInput = { organizationId };

  if (!currentSearchParams) {
    return where;
  }

  const searchParams = new URLSearchParams(currentSearchParams);
  const paramsValues = getParamsValues(searchParams);

  const { categoriesIds, locationIds, tagsIds, search, teamMemberIds } =
    paramsValues;

  const status =
    searchParams.get("status") === "ALL" // If the value is "ALL", we just remove the param
      ? null
      : (searchParams.get("status") as AssetStatus | null);

  if (search) {
    where.title = {
      contains: search.toLowerCase().trim(),
      mode: "insensitive",
    };
  }

  if (status) {
    where.status = status;
  }

  if (categoriesIds && categoriesIds.length > 0) {
    if (categoriesIds.includes("uncategorized")) {
      where.OR = [
        {
          categoryId: {
            in: categoriesIds,
          },
        },
        {
          categoryId: null,
        },
      ];
    } else {
      where.categoryId = {
        in: categoriesIds,
      };
    }
  }

  if (tagsIds && tagsIds.length > 0) {
    if (tagsIds.includes("untagged")) {
      where.OR = [
        ...(where.OR ?? []),
        { tags: { some: { id: { in: tagsIds } } } },
        { tags: { none: {} } },
      ];
    } else {
      where.tags = {
        some: {
          id: {
            in: tagsIds,
          },
        },
      };
    }
  }

  if (locationIds && locationIds.length > 0) {
    if (locationIds.includes("without-location")) {
      where.OR = [
        ...(where.OR ?? []),
        { locationId: { in: locationIds } },
        { locationId: null },
      ];
    } else {
      where.location = {
        id: { in: locationIds },
      };
    }
  }

  if (teamMemberIds && teamMemberIds.length) {
    where.OR = [
      ...(where.OR ?? []),
      {
        custody: { teamMemberId: { in: teamMemberIds } },
      },
      { custody: { custodian: { userId: { in: teamMemberIds } } } },
      {
        bookings: { some: { custodianTeamMemberId: { in: teamMemberIds } } },
      },
      { bookings: { some: { custodianUserId: { in: teamMemberIds } } } },
      ...(teamMemberIds.includes("without-custody") ? [{ custody: null }] : []),
    ];
  }

  return where;
}

/**
 * Schema for validating advanced filter parameter format
 * Validates the 'operator:value' format and ensures operator is valid
 */
export const advancedFilterFormatSchema = z.string().refine(
  (value) => {
    const parts = value.split(":");
    if (parts.length !== 2) return false;

    const [operator] = parts;
    return filterOperatorSchema.safeParse(operator).success;
  },
  {
    message: "Filter must be in format 'operator:value' with valid operator",
  }
);

/**
 * Validates if a filter value matches the expected advanced filter format
 * Uses Zod schema for strict type validation
 * @param value - The filter value to validate
 * @returns boolean indicating if the value matches advanced filter format
 */
function isValidAdvancedFilterFormat(value: string): boolean {
  return advancedFilterFormatSchema.safeParse(value).success;
}

/**
 * Validates and sanitizes URL parameters for advanced index mode
 * Removes any parameters that don't match the expected advanced filter format
 * @param searchParams - The URL search parameters to validate
 * @param columns - The configured columns for advanced index
 * @returns Validated and sanitized search parameters
 */
export function validateAdvancedFilterParams(
  searchParams: URLSearchParams,
  columns: Column[]
): URLSearchParams {
  const validatedParams = new URLSearchParams();
  const columnNames = columns.map((col) => col.name);

  // Iterate through all parameters
  searchParams.forEach((value, key) => {
    // Preserve non-filter params (pagination, sorting, etc)
    if (!columnNames.includes(key as any)) {
      validatedParams.append(key, value);
      return;
    }

    // Validate filter format for column parameters
    if (isValidAdvancedFilterFormat(value)) {
      validatedParams.append(key, value);
    }
    // Invalid format - parameter will be dropped
  });

  return validatedParams;
}

export const ASSET_CSV_HEADERS = [
  "title",
  "description",
  "category",
  "kit",
  "tags",
  "location",
  "custodian",
  "bookable",
  "imageUrl",
  "valuation",
  "qrId",
  "barcode_Code128",
  "barcode_Code39",
  "barcode_DataMatrix",
  "barcode_ExternalQR",
  "barcode_EAN13",
];

type AllSelectedValues = {
  selectedTags: string[];
  selectedCategory: string[];
  selectedLocation: string[];
};

/**
 * This function returns all the selected values from filters
 *
 * @returns {AllSelectedValues}
 */
export async function getAllSelectedValuesFromFilters(
  filters: string = "",
  columns: Column[],
  organizationId?: string
) {
  const parsedFilters = await parseFiltersWithHierarchy(
    filters,
    columns,
    organizationId
  );
  return parsedFilters.reduce((acc, curr) => {
    /*
     * We only have to take care of string values because most dropdown has string values only.
     * If in future we need any other type of selected values, then we can add them here.
     */
    if (typeof curr.value !== "string") {
      return acc;
    }

    return {
      ...acc,
      [`selected${_.capitalize(curr.name)}`]: curr.value.split(",") ?? [],
    };
  }, {} as AllSelectedValues);
}
