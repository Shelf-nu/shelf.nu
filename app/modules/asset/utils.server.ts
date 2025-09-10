import type { Asset, AssetStatus, Location, Prisma } from "@prisma/client";
import _ from "lodash";
import { z } from "zod";
import { filterOperatorSchema } from "~/components/assets/assets-index/advanced-filters/schema";
import { getDateTimeFormat } from "~/utils/client-hints";
import { getParamsValues } from "~/utils/list";
import { parseFilters } from "./query.server";
import type { AdvancedIndexAsset } from "./types";
import type { Column } from "../asset-index-settings/helpers";

export function getLocationUpdateNoteContent({
  currentLocation,
  newLocation,
  firstName,
  lastName,
  assetName,
  isRemoving,
}: {
  currentLocation?: Pick<Location, "id" | "name"> | null;
  newLocation?: Location | null;
  firstName: string;
  lastName: string;
  assetName: string;
  isRemoving?: boolean;
}) {
  let message = "";
  if (currentLocation && newLocation) {
    message = `**${firstName.trim()} ${lastName.trim()}** updated the location of **${assetName.trim()}** from **[${currentLocation.name.trim()}](/locations/${
      currentLocation.id
    })** to **[${newLocation.name.trim()}](/locations/${newLocation.id})**`; // updating location
  }

  if (newLocation && !currentLocation) {
    message = `**${firstName.trim()} ${lastName.trim()}** set the location of **${assetName.trim()}** to **[${newLocation.name.trim()}](/locations/${
      newLocation.id
    })**`; // setting to first location
  }

  if (isRemoving || !newLocation) {
    message = `**${firstName.trim()} ${lastName.trim()}** removed  **${assetName.trim()}** from location **[${currentLocation?.name.trim()}](/locations/${currentLocation?.id})**`; // removing location
  }

  return message;
}

export function getCustomFieldUpdateNoteContent({
  customFieldName,
  previousValue,
  newValue,
  firstName,
  lastName,
  assetName,
  isFirstTimeSet,
}: {
  customFieldName: string;
  previousValue?: string | null;
  newValue?: string | null;
  firstName: string;
  lastName: string;
  assetName: string;
  isFirstTimeSet: boolean;
}) {
  const fullName = `${firstName.trim()} ${lastName.trim()}`;
  let message = "";

  if (isFirstTimeSet && newValue) {
    // First time setting a value
    message = `**${fullName}** set **${customFieldName}** of **${assetName.trim()}** to **${newValue}**`;
  } else if (previousValue && newValue) {
    // Changing from one value to another
    message = `**${fullName}** updated **${customFieldName}** of **${assetName.trim()}** from **${previousValue}** to **${newValue}**`;
  } else if (previousValue && !newValue) {
    // Removing a value
    message = `**${fullName}** removed **${customFieldName}** value **${previousValue}** from **${assetName.trim()}**`;
  }

  return message;
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

export function formatAssetsRemindersDates({
  assets,
  request,
}: {
  assets: AdvancedIndexAsset[];
  request: Request;
}) {
  if (!assets.length) {
    return assets;
  }

  return assets.map((asset) => {
    if (!asset.upcomingReminder) {
      return asset;
    }

    return {
      ...asset,
      upcomingReminder: {
        ...asset.upcomingReminder,
        displayDate: getDateTimeFormat(request, {
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date(asset.upcomingReminder.alertDateTime)),
      },
    };
  });
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
export function getAllSelectedValuesFromFilters(
  filters: string = "",
  columns: Column[]
) {
  const parsedFilters = parseFilters(filters, columns);
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
