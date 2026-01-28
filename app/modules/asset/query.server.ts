import { Prisma } from "@prisma/client";
import type { CustomFieldType } from "@prisma/client";

import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import { parseFilters } from "./filter-parsing";
import { expandLocationHierarchyFilters } from "./location-filter.server";
import type { CustomFieldSorting } from "./types";
import type { Column } from "../asset-index-settings/helpers";

export const CUSTOM_FIELD_SEARCH_PATHS = [
  "valueText",
  "valueMultiLineText",
  "valueOption",
  "valueDate",
  "valueBoolean",
  "raw",
] as const;

/**
 * Generates the SQL WHERE clause for asset filtering
 * @param organizationId - Organization ID to filter by
 * @param search - Optional search string
 * @param filters - Array of filter objects
 * @param assetIds - Optional array of specific asset IDs to include
 * @returns Prisma.Sql WHERE clause
 */
export function generateWhereClause(
  organizationId: string,
  search: string | null,
  filters: Filter[],
  assetIds?: string[],
  availableToBookOnly = false
): Prisma.Sql {
  let whereClause = Prisma.sql`WHERE a."organizationId" = ${organizationId}`;

  if (availableToBookOnly) {
    whereClause = Prisma.sql`${whereClause} AND a."availableToBook" = true`;
  }

  // Add asset IDs filter if provided
  if (assetIds && assetIds.length > 0) {
    whereClause = Prisma.sql`${whereClause} AND a.id = ANY(${assetIds}::text[])`;
  }

  if (search) {
    const words = search
      .trim()
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);

    if (words.length > 0) {
      // Create OR conditions for each search term, searching across multiple fields
      const searchConditions = words.map(
        (term) => Prisma.sql`(
          a.title ILIKE ${`%${term}%`} OR
          a.description ILIKE ${`%${term}%`} OR
          a."sequentialId" ILIKE ${`%${term}%`} OR
          c.name ILIKE ${`%${term}%`} OR
          l.name ILIKE ${`%${term}%`} OR
          t.name ILIKE ${`%${term}%`} OR
          tm.name ILIKE ${`%${term}%`} OR
          u."firstName" ILIKE ${`%${term}%`} OR
          u."lastName" ILIKE ${`%${term}%`} OR
          EXISTS (
            SELECT 1 FROM public."Qr" q 
            WHERE q."assetId" = a.id AND q.id ILIKE ${`%${term}%`}
          ) OR
          EXISTS (
            SELECT 1 FROM public."Barcode" b 
            WHERE b."assetId" = a.id AND b.value ILIKE ${`%${term}%`}
          ) OR
          EXISTS (
            SELECT 1 FROM public."AssetCustomFieldValue" acfv 
            WHERE acfv."assetId" = a.id AND (
              ${Prisma.join(
                CUSTOM_FIELD_SEARCH_PATHS.map(
                  (jsonPath) =>
                    Prisma.sql`acfv.value#>>${Prisma.raw(
                      `'{${jsonPath}}'`
                    )} ILIKE ${`%${term}%`}`
                ),
                " OR "
              )}
            )
          )
        )`
      );

      // Combine all search terms with OR
      whereClause = Prisma.sql`${whereClause} AND (${Prisma.join(
        searchConditions,
        " OR "
      )})`;
    }
  }

  // Process each filter
  for (const filter of filters) {
    switch (filter.type) {
      case "string":
        if (
          ["location", "kit", "category", "qrId"].includes(filter.name) ||
          filter.name.startsWith("barcode_")
        ) {
          whereClause = addRelationFilter(whereClause, filter);
        } else {
          whereClause = addStringFilter(whereClause, filter);
        }
        break;
      case "text":
        whereClause = addStringFilter(whereClause, filter);
        break;
      case "number":
        whereClause = addNumberFilter(whereClause, filter);
        break;
      case "boolean":
        whereClause = addBooleanFilter(whereClause, filter);
        break;
      case "date":
        whereClause = addDateFilter(whereClause, filter);
        break;
      case "enum":
        whereClause = addEnumFilter(whereClause, filter);
        break;
      case "array":
        whereClause = addArrayFilter(whereClause, filter);
        break;
      case "customField":
        whereClause = addCustomFieldFilter(whereClause, filter);
        break;
      // Add other cases as needed
    }
  }

  return whereClause;
}

function addCustomFieldFilter(
  whereClause: Prisma.Sql,
  filter: Filter
): Prisma.Sql {
  const customFieldName = filter.name.slice(3); // Remove 'cf_' prefix

  // Create a subquery to get the custom field value
  const subquery = Prisma.sql`(
    SELECT acfv.value->>'raw'
    FROM public."AssetCustomFieldValue" acfv
    JOIN public."CustomField" cf ON acfv."customFieldId" = cf.id
    WHERE acfv."assetId" = a.id AND cf.name = ${customFieldName}
  )`;

  switch (filter.fieldType) {
    case "TEXT":
    case "MULTILINE_TEXT":
      return addCustomFieldStringFilter(whereClause, filter, subquery);
    case "DATE":
      return addCustomFieldDateFilter(whereClause, filter, subquery);
    case "BOOLEAN":
      return addCustomFieldBooleanFilter(whereClause, filter, subquery);
    case "OPTION":
      return addCustomFieldOptionFilter(whereClause, filter, subquery);
    case "AMOUNT":
    case "NUMBER":
      return addCustomFieldNumberFilter(whereClause, filter, subquery);
    default:
      return whereClause;
  }
}

function addCustomFieldStringFilter(
  whereClause: Prisma.Sql,
  filter: Filter,
  subquery: Prisma.Sql
): Prisma.Sql {
  switch (filter.operator) {
    case "is":
      return Prisma.sql`${whereClause} AND ${subquery} = ${filter.value}`;
    case "isNot":
      return Prisma.sql`${whereClause} AND ${subquery} != ${filter.value}`;
    case "contains":
      return Prisma.sql`${whereClause} AND ${subquery} ILIKE ${`%${filter.value}%`}`;
    case "matchesAny": {
      const values = (filter.value as string).split(",").map((v) => v.trim());
      const valuesArray = Prisma.join(
        values.map((v) => Prisma.sql`${v}`),
        ", "
      );
      return Prisma.sql`${whereClause} AND ${subquery} = ANY(ARRAY[${valuesArray}])`;
    }
    case "containsAny": {
      const values = (filter.value as string).split(",").map((v) => v.trim());
      const likeConditions = values.map(
        (value) => Prisma.sql`${subquery} ILIKE ${`%${value}%`}`
      );
      return Prisma.sql`${whereClause} AND (${Prisma.join(
        likeConditions,
        " OR "
      )})`;
    }
    default:
      return whereClause;
  }
}

function addCustomFieldDateFilter(
  whereClause: Prisma.Sql,
  filter: Filter,
  subquery: Prisma.Sql
): Prisma.Sql {
  switch (filter.operator) {
    case "is":
      return Prisma.sql`${whereClause} AND (${subquery})::date = ${filter.value}::date`;
    case "isNot":
      return Prisma.sql`${whereClause} AND (${subquery})::date != ${filter.value}::date`;
    case "before":
      return Prisma.sql`${whereClause} AND (${subquery})::date < ${filter.value}::date`;
    case "after":
      return Prisma.sql`${whereClause} AND (${subquery})::date > ${filter.value}::date`;
    case "between": {
      const [start, end] = filter.value as [string, string];
      return Prisma.sql`${whereClause} AND (${subquery})::date BETWEEN ${start}::date AND ${end}::date`;
    }
    case "inDates": {
      const dates = (filter.value as string).split(",").map((d) => d.trim());
      const datesArray = Prisma.join(
        dates.map((d) => Prisma.sql`${d}`),
        ", "
      );
      return Prisma.sql`${whereClause} AND (${subquery})::date = ANY(ARRAY[${datesArray}]::date[])`;
    }
    default:
      return whereClause;
  }
}

function addCustomFieldBooleanFilter(
  whereClause: Prisma.Sql,
  filter: Filter,
  subquery: Prisma.Sql
): Prisma.Sql {
  return Prisma.sql`${whereClause} AND (${subquery})::boolean = ${filter.value}`;
}

function addCustomFieldOptionFilter(
  whereClause: Prisma.Sql,
  filter: Filter,
  subquery: Prisma.Sql
): Prisma.Sql {
  switch (filter.operator) {
    case "is":
      return Prisma.sql`${whereClause} AND ${subquery} = ${filter.value}`;
    case "isNot":
      return Prisma.sql`${whereClause} AND ${subquery} != ${filter.value}`;
    case "containsAny": {
      let valuesArray;

      // Ensure filter.value is an array, and parse it if necessary
      if (Array.isArray(filter.value)) {
        valuesArray = filter.value;
      } else if (typeof filter.value === "string") {
        // If filter.value is a string, parse it as a JSON array or split by commas
        try {
          valuesArray = JSON.parse(filter.value);
        } catch {
          // If parsing fails, fallback to splitting the string by comma (adjust as necessary)
          valuesArray = filter.value.split(",").map((val) => val.trim());
        }
      } else {
        // If filter.value is neither, default to an empty array
        valuesArray = [];
      }

      // Construct the PostgreSQL array literal
      const arrayLiteral = `{${valuesArray
        .map((val: string) => `"${val}"`)
        .join(",")}}`;

      return Prisma.sql`${whereClause} AND ${subquery} = ANY(${arrayLiteral}::text[])`;
    }
    default:
      return whereClause;
  }
}

function addCustomFieldNumberFilter(
  whereClause: Prisma.Sql,
  filter: Filter,
  subquery: Prisma.Sql
): Prisma.Sql {
  // Ensure the filter value is a number
  const numericValue =
    typeof filter.value === "string" ? parseFloat(filter.value) : filter.value;

  switch (filter.operator) {
    case "is":
      return Prisma.sql`${whereClause} AND (${subquery})::float = ${numericValue}`;
    case "isNot":
      return Prisma.sql`${whereClause} AND (${subquery})::float != ${numericValue}`;
    case "gt":
      return Prisma.sql`${whereClause} AND (${subquery})::float > ${numericValue}`;
    case "lt":
      return Prisma.sql`${whereClause} AND (${subquery})::float < ${numericValue}`;
    case "gte":
      return Prisma.sql`${whereClause} AND (${subquery})::float >= ${numericValue}`;
    case "lte":
      return Prisma.sql`${whereClause} AND (${subquery})::float <= ${numericValue}`;
    case "between": {
      const [min, max] = filter.value as [number, number];
      // Ensure min and max are numbers
      const minValue = typeof min === "string" ? parseFloat(min) : min;
      const maxValue = typeof max === "string" ? parseFloat(max) : max;
      return Prisma.sql`${whereClause} AND (${subquery})::float BETWEEN ${minValue} AND ${maxValue}`;
    }
    default:
      return whereClause;
  }
}

function addStringFilter(whereClause: Prisma.Sql, filter: Filter): Prisma.Sql {
  switch (filter.operator) {
    case "is":
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(filter.name)}" = ${
        filter.value
      }`;
    case "isNot":
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(filter.name)}" != ${
        filter.value
      }`;
    case "contains":
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(
        filter.name
      )}" ILIKE ${`%${filter.value}%`}`;
    case "matchesAny": {
      // Split comma-separated values and remove whitespace
      const values = (filter.value as string).split(",").map((v) => v.trim());
      // Create array literal for Postgres
      const valuesArray = Prisma.join(
        values.map((v) => Prisma.sql`${v}`),
        ", "
      );
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(
        filter.name
      )}" = ANY(ARRAY[${valuesArray}]::text[])`;
    }
    case "containsAny": {
      const values = (filter.value as string).split(",").map((v) => v.trim());
      // Build OR condition for ILIKE
      const likeConditions = values.map(
        (value) =>
          Prisma.sql`a."${Prisma.raw(filter.name)}" ILIKE ${`%${value}%`}`
      );
      return Prisma.sql`${whereClause} AND (${Prisma.join(
        likeConditions,
        " OR "
      )})`;
    }
    default:
      return whereClause;
  }
}

function addNumberFilter(whereClause: Prisma.Sql, filter: Filter): Prisma.Sql {
  switch (filter.operator) {
    case "is":
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(filter.name)}" = ${
        filter.value
      }`;
    case "isNot":
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(filter.name)}" != ${
        filter.value
      }`;
    case "gt":
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(filter.name)}" > ${
        filter.value
      }`;
    case "lt":
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(filter.name)}" < ${
        filter.value
      }`;
    case "gte":
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(filter.name)}" >= ${
        filter.value
      }`;
    case "lte":
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(filter.name)}" <= ${
        filter.value
      }`;
    case "between": {
      const [min, max] = filter.value as [number, number];
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(
        filter.name
      )}" BETWEEN ${min} AND ${max}`;
    }
    default:
      return whereClause;
  }
}

function addBooleanFilter(whereClause: Prisma.Sql, filter: Filter): Prisma.Sql {
  return Prisma.sql`${whereClause} AND a."${Prisma.raw(filter.name)}" = ${
    filter.value
  }`;
}

function addDateFilter(whereClause: Prisma.Sql, filter: Filter): Prisma.Sql {
  switch (filter.operator) {
    case "is":
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(
        filter.name
      )}"::date = ${filter.value}::date`;
    case "isNot":
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(
        filter.name
      )}"::date != ${filter.value}::date`;
    case "before":
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(filter.name)}" < ${
        filter.value
      }::date`;
    case "after":
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(filter.name)}" > ${
        filter.value
      }::date`;
    case "between": {
      const [start, end] = filter.value as [string, string];
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(
        filter.name
      )}" BETWEEN ${start}::date AND ${end}::date`;
    }
    case "inDates": {
      // Split comma-separated dates and remove whitespace
      const dates = (filter.value as string).split(",").map((d) => d.trim());
      // Create array literal for Postgres
      const datesArray = Prisma.join(
        dates.map((d) => Prisma.sql`${d}`),
        ", "
      );
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(
        filter.name
      )}"::date = ANY(ARRAY[${datesArray}]::date[])`;
    }
    default:
      return whereClause;
  }
}

function addEnumFilter(whereClause: Prisma.Sql, filter: Filter): Prisma.Sql {
  if (filter.name === "status") {
    switch (filter.operator) {
      case "is": {
        const trimmedValue =
          typeof filter.value === "string" ? filter.value.trim() : filter.value;
        return Prisma.sql`${whereClause} AND a.status = ${trimmedValue}::public."AssetStatus"`;
      }
      case "isNot": {
        const trimmedValue =
          typeof filter.value === "string" ? filter.value.trim() : filter.value;
        return Prisma.sql`${whereClause} AND a.status != ${trimmedValue}::public."AssetStatus"`;
      }
      case "containsAny": {
        const values = (filter.value as string).split(",").map((v) => v.trim());
        const valuesArray = Prisma.join(
          values.map((v) => Prisma.sql`${v}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND a.status = ANY(ARRAY[${valuesArray}]::public."AssetStatus"[])`;
      }
      default:
        return whereClause;
    }
  }

  // Handle custody enums by delegating to specialized function
  if (filter.name === "custody") {
    return addCustodyFilter(whereClause, filter);
  }

  // Add category handling using asset's categoryId since we're using LEFT JOIN
  if (filter.name === "category") {
    switch (filter.operator) {
      case "is":
        if (filter.value === "uncategorized") {
          return Prisma.sql`${whereClause} AND a."categoryId" IS NULL`;
        }
        //Reference the category table for name comparison
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."Category"
          WHERE id = a."categoryId" AND id = ${filter.value}
        )`;

      case "isNot":
        if (filter.value === "uncategorized") {
          return Prisma.sql`${whereClause} AND a."categoryId" IS NOT NULL`;
        }
        return Prisma.sql`${whereClause} AND (
          NOT EXISTS (
            SELECT 1 FROM public."Category"
            WHERE id = a."categoryId" AND id = ${filter.value}
          ) OR a."categoryId" IS NULL
        )`;

      case "containsAny": {
        const values = (
          typeof filter.value === "string"
            ? filter.value.split(",").map((v) => v.trim())
            : Array.isArray(filter.value)
              ? filter.value
              : [filter.value]
        ).filter(Boolean);

        if (values.includes("uncategorized")) {
          // Remove "uncategorized" from the values array
          const categoryIds = values.filter((v) => v !== "uncategorized");

          if (categoryIds.length === 0) {
            return Prisma.sql`${whereClause} AND a."categoryId" IS NULL`;
          }

          const categoryIdsArray = Prisma.join(
            categoryIds.map((id) => Prisma.sql`${id}`),
            ", "
          );
          return Prisma.sql`${whereClause} AND (
            a."categoryId" IS NULL
            OR EXISTS (
              SELECT 1 FROM public."Category"
              WHERE id = a."categoryId" AND id = ANY(ARRAY[${categoryIdsArray}]::text[])
            )
          )`;
        }

        const categoryIdsArray = Prisma.join(
          values.map((id) => Prisma.sql`${id}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."Category"
          WHERE id = a."categoryId" AND id = ANY(ARRAY[${categoryIdsArray}]::text[])
        )`;
      }

      default:
        return whereClause;
    }
  }

  // Add location handling using asset's locationId since we're using LEFT JOIN
  if (filter.name === "location") {
    switch (filter.operator) {
      case "is":
        if (filter.value === "in-location") {
          return Prisma.sql`${whereClause} AND a."locationId" IS NOT NULL`;
        }
        if (filter.value === "without-location") {
          return Prisma.sql`${whereClause} AND a."locationId" IS NULL`;
        }
        //Reference the Location table for name comparison
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."Location"
          WHERE id = a."locationId" AND id = ${filter.value}
        )`;

      case "isNot":
        if (filter.value === "in-location") {
          return Prisma.sql`${whereClause} AND a."locationId" IS NULL`;
        }
        if (filter.value === "without-location") {
          return Prisma.sql`${whereClause} AND a."locationId" IS NOT NULL`;
        }
        return Prisma.sql`${whereClause} AND (
          NOT EXISTS (
            SELECT 1 FROM public."Location"
            WHERE id = a."locationId" AND id = ${filter.value}
          ) OR a."locationId" IS NULL
        )`;

      case "containsAny": {
        const values = (
          typeof filter.value === "string"
            ? filter.value.split(",").map((v) => v.trim())
            : Array.isArray(filter.value)
              ? filter.value
              : [filter.value]
        ).filter(Boolean);

        const hasLocation = values.includes("in-location");
        const hasWithoutLocation = values.includes("without-location");

        // If both are selected, match all assets
        if (hasLocation && hasWithoutLocation) {
          return whereClause;
        }

        // Handle "in-location" - assets that have a location
        if (hasLocation) {
          return Prisma.sql`${whereClause} AND a."locationId" IS NOT NULL`;
        }

        // Handle "without-location" - assets that don't have a location
        if (hasWithoutLocation) {
          const locationIds = values.filter((v) => v !== "without-location");

          if (locationIds.length === 0) {
            return Prisma.sql`${whereClause} AND a."locationId" IS NULL`;
          }

          const locationIdsArray = Prisma.join(
            locationIds.map((id) => Prisma.sql`${id}`),
            ", "
          );
          return Prisma.sql`${whereClause} AND (
            a."locationId" IS NULL
            OR EXISTS (
              SELECT 1 FROM public."Location"
              WHERE id = a."locationId" AND id = ANY(ARRAY[${locationIdsArray}]::text[])
            )
          )`;
        }

        const locationIdsArray = Prisma.join(
          values.map((id) => Prisma.sql`${id}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."Location"
          WHERE id = a."locationId" AND id = ANY(ARRAY[${locationIdsArray}]::text[])
        )`;
      }

      default:
        return whereClause;
    }
  }

  // Add upcomingBookings handling to filter by booking ID
  if (filter.name === "upcomingBookings") {
    switch (filter.operator) {
      case "is":
        // Filter assets that are in the specified booking
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."_AssetToBooking" atb
          JOIN public."Booking" bk ON atb."B" = bk.id
          WHERE atb."A" = a.id
          AND bk.id = ${filter.value}
          AND bk.status IN ('DRAFT', 'RESERVED', 'ONGOING', 'OVERDUE')
        )`;

      case "isNot":
        // Filter assets that are NOT in the specified booking
        return Prisma.sql`${whereClause} AND NOT EXISTS (
          SELECT 1 FROM public."_AssetToBooking" atb
          JOIN public."Booking" bk ON atb."B" = bk.id
          WHERE atb."A" = a.id
          AND bk.id = ${filter.value}
          AND bk.status IN ('DRAFT', 'RESERVED', 'ONGOING', 'OVERDUE')
        )`;

      case "containsAny": {
        const values = (
          typeof filter.value === "string"
            ? filter.value.split(",").map((v) => v.trim())
            : Array.isArray(filter.value)
            ? filter.value
            : [filter.value]
        ).filter(Boolean);

        const bookingIdsArray = Prisma.join(
          values.map((id) => Prisma.sql`${id}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."_AssetToBooking" atb
          JOIN public."Booking" bk ON atb."B" = bk.id
          WHERE atb."A" = a.id
          AND bk.id = ANY(ARRAY[${bookingIdsArray}]::text[])
          AND bk.status IN ('DRAFT', 'RESERVED', 'ONGOING', 'OVERDUE')
        )`;
      }

      default:
        return whereClause;
    }
  }

  // Add kit handling using asset's kitId since we're using LEFT JOIN
  if (filter.name === "kit") {
    switch (filter.operator) {
      case "is":
        if (filter.value === "in-kit") {
          return Prisma.sql`${whereClause} AND a."kitId" IS NOT NULL`;
        }
        if (filter.value === "without-kit") {
          return Prisma.sql`${whereClause} AND a."kitId" IS NULL`;
        }
        //Reference the Kit table for name comparison
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."Kit"
          WHERE id = a."kitId" AND id = ${filter.value}
        )`;

      case "isNot":
        if (filter.value === "in-kit") {
          return Prisma.sql`${whereClause} AND a."kitId" IS NULL`;
        }
        if (filter.value === "without-kit") {
          return Prisma.sql`${whereClause} AND a."kitId" IS NOT NULL`;
        }
        return Prisma.sql`${whereClause} AND (
          NOT EXISTS (
            SELECT 1 FROM public."Kit"
            WHERE id = a."kitId" AND id = ${filter.value}
          ) OR a."kitId" IS NULL
        )`;

      case "containsAny": {
        const values = (
          typeof filter.value === "string"
            ? filter.value.split(",").map((v) => v.trim())
            : Array.isArray(filter.value)
              ? filter.value
              : [filter.value]
        ).filter(Boolean);

        const hasInKit = values.includes("in-kit");
        const hasWithoutKit = values.includes("without-kit");

        // If both are selected, match all assets
        if (hasInKit && hasWithoutKit) {
          return whereClause;
        }

        // Handle "in-kit" - assets that are in a kit
        if (hasInKit) {
          return Prisma.sql`${whereClause} AND a."kitId" IS NOT NULL`;
        }

        // Handle "without-kit" - assets that are not in a kit
        if (hasWithoutKit) {
          const kitIds = values.filter((v) => v !== "without-kit");

          if (kitIds.length === 0) {
            return Prisma.sql`${whereClause} AND a."kitId" IS NULL`;
          }

          const kitIdsArray = Prisma.join(
            kitIds.map((id) => Prisma.sql`${id}`),
            ", "
          );
          return Prisma.sql`${whereClause} AND (
            a."kitId" IS NULL
            OR EXISTS (
              SELECT 1 FROM public."Kit"
              WHERE id = a."kitId" AND id = ANY(ARRAY[${kitIdsArray}]::text[])
            )
          )`;
        }

        const kitIdsArray = Prisma.join(
          values.map((id) => Prisma.sql`${id}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."Kit"
          WHERE id = a."kitId" AND id = ANY(ARRAY[${kitIdsArray}]::text[])
        )`;
      }

      default:
        return whereClause;
    }
  }

  return whereClause;
}

function addRelationFilter(
  whereClause: Prisma.Sql,
  filter: Filter
): Prisma.Sql {
  const relationAliasMap: Record<string, string> = {
    kit: "k",
    qrId: "q",
  };

  const alias = relationAliasMap[filter.name];

  // Special handling for qrId
  if (filter.name === "qrId") {
    switch (filter.operator) {
      case "is":
        return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."Qr" q WHERE q."assetId" = a.id AND q.id = ${filter.value})`;
      case "isNot":
        return Prisma.sql`${whereClause} AND NOT EXISTS (SELECT 1 FROM public."Qr" q WHERE q."assetId" = a.id AND q.id = ${filter.value})`;
      case "contains":
        return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."Qr" q WHERE q."assetId" = a.id AND q.id ILIKE ${`%${filter.value}%`})`;
      case "matchesAny": {
        const values = (filter.value as string).split(",").map((v) => v.trim());
        const valuesArray = Prisma.join(
          values.map((v) => Prisma.sql`${v}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."Qr" q WHERE q."assetId" = a.id AND q.id = ANY(ARRAY[${valuesArray}]::text[]))`;
      }
      case "containsAny": {
        const values = (filter.value as string).split(",").map((v) => v.trim());
        const likeConditions = values.map(
          (value) => Prisma.sql`q.id ILIKE ${`%${value}%`}`
        );
        return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."Qr" q WHERE q."assetId" = a.id AND (${Prisma.join(
          likeConditions,
          " OR "
        )}))`;
      }
      default:
        return whereClause;
    }
  }

  // Special handling for barcode fields
  if (filter.name.startsWith("barcode_")) {
    const barcodeType = filter.name.split("_")[1]; // Extract the barcode type (Code128, Code39, DataMatrix, etc.)

    // Normalize filter value to uppercase to match how barcodes are stored
    const normalizedValue =
      typeof filter.value === "string"
        ? filter.value.toUpperCase()
        : filter.value;

    switch (filter.operator) {
      case "is":
        return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."Barcode" b WHERE b."assetId" = a.id AND b.type::text = ${barcodeType} AND b.value = ${normalizedValue})`;
      case "isNot":
        return Prisma.sql`${whereClause} AND NOT EXISTS (SELECT 1 FROM public."Barcode" b WHERE b."assetId" = a.id AND b.type::text = ${barcodeType} AND b.value = ${normalizedValue})`;
      case "contains":
        return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."Barcode" b WHERE b."assetId" = a.id AND b.type::text = ${barcodeType} AND b.value ILIKE ${`%${normalizedValue}%`})`;
      case "matchesAny": {
        const values = (filter.value as string)
          .split(",")
          .map((v) => v.trim().toUpperCase());
        const valuesArray = Prisma.join(
          values.map((v) => Prisma.sql`${v}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."Barcode" b WHERE b."assetId" = a.id AND b.type::text = ${barcodeType} AND b.value = ANY(ARRAY[${valuesArray}]::text[]))`;
      }
      case "containsAny": {
        const values = (filter.value as string)
          .split(",")
          .map((v) => v.trim().toUpperCase());
        const likeConditions = values.map(
          (value) => Prisma.sql`b.value ILIKE ${`%${value}%`}`
        );
        return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."Barcode" b WHERE b."assetId" = a.id AND b.type::text = ${barcodeType} AND (${Prisma.join(
          likeConditions,
          " OR "
        )}))`;
      }
      default:
        return whereClause;
    }
  }

  switch (filter.operator) {
    case "is":
      return Prisma.sql`${whereClause} AND ${Prisma.raw(alias)}.name = ${
        filter.value
      }`;
    case "isNot":
      return Prisma.sql`${whereClause} AND ${Prisma.raw(alias)}.name != ${
        filter.value
      }`;
    case "contains":
      return Prisma.sql`${whereClause} AND ${Prisma.raw(
        alias
      )}.name ILIKE ${`%${filter.value}%`}`;
    case "matchesAny": {
      const values = (filter.value as string).split(",").map((v) => v.trim());
      const valuesArray = Prisma.join(
        values.map((v) => Prisma.sql`${v}`),
        ", "
      );
      return Prisma.sql`${whereClause} AND ${Prisma.raw(
        alias
      )}.name = ANY(ARRAY[${valuesArray}]::text[])`;
    }
    case "containsAny": {
      const values = (filter.value as string).split(",").map((v) => v.trim());
      const likeConditions = values.map(
        (value) => Prisma.sql`${Prisma.raw(alias)}.name ILIKE ${`%${value}%`}`
      );
      return Prisma.sql`${whereClause} AND (${Prisma.join(
        likeConditions,
        " OR "
      )})`;
    }
    default:
      return whereClause;
  }
}

/**
 * Adds custody-specific filtering to the WHERE clause
 * Handles both direct custody via TeamMember ID and indirect custody via Bookings
 * @param whereClause - The existing WHERE clause to extend
 * @param filter - The filter containing custody search criteria
 * @returns Extended WHERE clause with custody conditions
 */
function addCustodyFilter(whereClause: Prisma.Sql, filter: Filter): Prisma.Sql {
  switch (filter.operator) {
    case "is":
      if (filter.value === "in-custody") {
        // Include both direct custody and active booking custody
        return Prisma.sql`${whereClause} AND (
          cu.id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM "Booking" b
            JOIN "_AssetToBooking" atb ON b.id = atb."B" AND a.id = atb."A"
            WHERE b.status IN ('ONGOING', 'OVERDUE')
          )
        )`;
      }
      if (filter.value === "without-custody") {
        // Exclude both direct custody and active booking custody
        return Prisma.sql`${whereClause} AND cu.id IS NULL AND NOT EXISTS (
          SELECT 1 FROM "Booking" b
          JOIN "_AssetToBooking" atb ON b.id = atb."B" AND a.id = atb."A"
          WHERE b.status IN ('ONGOING', 'OVERDUE')
        )`;
      }
      return Prisma.sql`${whereClause} AND (
        EXISTS (
          SELECT 1 FROM "Custody" cu 
          WHERE cu."assetId" = a.id 
          AND cu."teamMemberId" = ${filter.value}
        )
        OR EXISTS (
          SELECT 1 FROM "Booking" b 
          JOIN "_AssetToBooking" atb ON b.id = atb."B" AND a.id = atb."A"
          WHERE b.status IN ('ONGOING', 'OVERDUE')
          AND (
            b."custodianTeamMemberId" = ${filter.value}
            OR b."custodianUserId" = (
              SELECT "userId" FROM "TeamMember" tm WHERE tm.id = ${filter.value}
            )
          )
        )
      )`;

    case "isNot":
      if (filter.value === "in-custody") {
        // Exclude both direct custody and active booking custody
        return Prisma.sql`${whereClause} AND cu.id IS NULL AND NOT EXISTS (
          SELECT 1 FROM "Booking" b
          JOIN "_AssetToBooking" atb ON b.id = atb."B" AND a.id = atb."A"
          WHERE b.status IN ('ONGOING', 'OVERDUE')
        )`;
      }
      if (filter.value === "without-custody") {
        // Include both direct custody and active booking custody
        return Prisma.sql`${whereClause} AND (
          cu.id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM "Booking" b
            JOIN "_AssetToBooking" atb ON b.id = atb."B" AND a.id = atb."A"
            WHERE b.status IN ('ONGOING', 'OVERDUE')
          )
        )`;
      }
      return Prisma.sql`${whereClause} AND NOT (
        EXISTS (
          SELECT 1 FROM "Custody" cu
          WHERE cu."assetId" = a.id
          AND cu."teamMemberId" = ${filter.value}
        )
        OR EXISTS (
          SELECT 1 FROM "Booking" b
          JOIN "_AssetToBooking" atb ON b.id = atb."B" AND a.id = atb."A"
          WHERE b.status IN ('ONGOING', 'OVERDUE')
          AND (
            b."custodianTeamMemberId" = ${filter.value}
            OR b."custodianUserId" = (
              SELECT "userId" FROM "TeamMember" tm WHERE tm.id = ${filter.value}
            )
          )
        )
      )`;

    case "containsAny": {
      const values = (
        typeof filter.value === "string"
          ? filter.value.split(",").map((v) => v.trim())
          : Array.isArray(filter.value)
            ? filter.value
            : [filter.value]
      ).filter(Boolean);

      const hasInCustody = values.includes("in-custody");
      const hasWithoutCustody = values.includes("without-custody");

      // If both "in-custody" and "without-custody" are selected, match all assets
      if (hasInCustody && hasWithoutCustody) {
        return whereClause;
      }

      // Handle "in-custody" - assets that have a custodian (direct or via booking)
      if (hasInCustody) {
        // "in-custody" subsumes specific custodian IDs - just check for any custody
        return Prisma.sql`${whereClause} AND (
          cu.id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM "Booking" b
            JOIN "_AssetToBooking" atb ON b.id = atb."B" AND a.id = atb."A"
            WHERE b.status IN ('ONGOING', 'OVERDUE')
          )
        )`;
      }

      // Handle "without-custody" - assets that don't have a custodian
      if (hasWithoutCustody) {
        const custodianIds = values.filter((v) => v !== "without-custody");

        if (custodianIds.length === 0) {
          return Prisma.sql`${whereClause} AND cu.id IS NULL AND NOT EXISTS (
            SELECT 1 FROM "Booking" b
            JOIN "_AssetToBooking" atb ON b.id = atb."B" AND a.id = atb."A"
            WHERE b.status IN ('ONGOING', 'OVERDUE')
          )`;
        }

        const custodianIdsArray = Prisma.join(
          custodianIds.map((id) => Prisma.sql`${id}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND (
          (cu.id IS NULL AND NOT EXISTS (
            SELECT 1 FROM "Booking" b
            JOIN "_AssetToBooking" atb ON b.id = atb."B" AND a.id = atb."A"
            WHERE b.status IN ('ONGOING', 'OVERDUE')
          ))
          OR EXISTS (
            SELECT 1 FROM "Custody" cu
            WHERE cu."assetId" = a.id
            AND cu."teamMemberId" = ANY(ARRAY[${custodianIdsArray}]::text[])
          )
          OR EXISTS (
            SELECT 1 FROM "Booking" b
            JOIN "_AssetToBooking" atb ON b.id = atb."B" AND a.id = atb."A"
            WHERE b.status IN ('ONGOING', 'OVERDUE')
            AND (
              b."custodianTeamMemberId" = ANY(ARRAY[${custodianIdsArray}]::text[])
              OR b."custodianUserId" IN (
                SELECT "userId" FROM "TeamMember" tm
                WHERE tm.id = ANY(ARRAY[${custodianIdsArray}]::text[])
              )
            )
          )
        )`;
      }

      const custodianIdsArray = Prisma.join(
        values.map((id) => Prisma.sql`${id}`),
        ", "
      );
      return Prisma.sql`${whereClause} AND (
        EXISTS (
          SELECT 1 FROM "Custody" cu
          WHERE cu."assetId" = a.id
          AND cu."teamMemberId" = ANY(ARRAY[${custodianIdsArray}]::text[])
        )
        OR EXISTS (
          SELECT 1 FROM "Booking" b
          JOIN "_AssetToBooking" atb ON b.id = atb."B" AND a.id = atb."A"
          WHERE b.status IN ('ONGOING', 'OVERDUE')
          AND (
            b."custodianTeamMemberId" = ANY(ARRAY[${custodianIdsArray}]::text[])
            OR b."custodianUserId" IN (
              SELECT "userId" FROM "TeamMember" tm
              WHERE tm.id = ANY(ARRAY[${custodianIdsArray}]::text[])
            )
          )
        )
      )`;
    }

    default:
      return whereClause;
  }
}
/**
 * Handles array type filters (e.g., tags)
 * @param whereClause - The existing WHERE clause
 * @param filter - The filter configuration
 * @returns Modified WHERE clause with array filtering conditions
 */
function addArrayFilter(whereClause: Prisma.Sql, filter: Filter): Prisma.Sql {
  /**
   * NOTE: This currently only works for tags. Will need to be adjusted once we have more arrays to filter by
   */
  switch (filter.operator) {
    case "contains": {
      // Handle "untagged" special case
      if (filter.value === "untagged") {
        return Prisma.sql`${whereClause} AND NOT EXISTS (
          SELECT 1 FROM "_AssetToTag" att
          WHERE att."A" = a.id
        )`;
      }
      // Single tag filtering using the existing join
      return Prisma.sql`${whereClause} AND t.id = ${filter.value}`;
    }
    case "containsAll": {
      // ALL tags must be present
      const values = (filter.value as string).split(",").map((v) => v.trim());

      // If "untagged" is included, return assets with no tags
      // (an asset can't be both untagged and have tags)
      if (values.includes("untagged")) {
        return Prisma.sql`${whereClause} AND NOT EXISTS (
          SELECT 1 FROM "_AssetToTag" att
          WHERE att."A" = a.id
        )`;
      }

      const valuesArray = Prisma.join(
        values.map((v) => Prisma.sql`${v}`),
        ", "
      );
      return Prisma.sql`${whereClause} AND NOT EXISTS (
        SELECT unnest(ARRAY[${valuesArray}]::text[]) AS required_tag
        EXCEPT
        SELECT t.id
        FROM "_AssetToTag" att
        JOIN "Tag" t ON t.id = att."B"
        WHERE att."A" = a.id
      )`;
    }
    case "containsAny": {
      // ANY of the tags must be present
      const values = (filter.value as string).split(",").map((v) => v.trim());

      // If "untagged" is included, we need OR logic:
      // Either the asset has no tags OR it has one of the other specified tags
      if (values.includes("untagged")) {
        // Remove "untagged" from the values array
        const tagIds = values.filter((v) => v !== "untagged");

        if (tagIds.length === 0) {
          // Only "untagged" was selected - return assets with no tags
          return Prisma.sql`${whereClause} AND NOT EXISTS (
            SELECT 1 FROM "_AssetToTag" att
            WHERE att."A" = a.id
          )`;
        }

        // Return assets that are either untagged OR have one of the specified tags
        const valuesArray = Prisma.join(
          tagIds.map((id) => Prisma.sql`${id}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND (
          NOT EXISTS (SELECT 1 FROM "_AssetToTag" att WHERE att."A" = a.id)
          OR t.id = ANY(ARRAY[${valuesArray}]::text[])
        )`;
      }

      const valuesArray = Prisma.join(
        values.map((v) => Prisma.sql`${v}`),
        ", "
      );
      return Prisma.sql`${whereClause} AND t.id = ANY(ARRAY[${valuesArray}]::text[])`;
    }

    case "excludeAny": {
      // Exclude assets that have ANY of the specified tags
      const values = (filter.value as string).split(",").map((v) => v.trim());

      if (values.includes("untagged")) {
        // If "untagged" is included, we want to ensure assets have at least one tag
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM "_AssetToTag" att2
          WHERE att2."A" = a.id
        )`;
      }

      const valuesArray = Prisma.join(
        values.map((v) => Prisma.sql`${v}`),
        ", "
      );
      return Prisma.sql`${whereClause} AND NOT EXISTS (
        SELECT 1
        FROM "_AssetToTag" att2
        JOIN "Tag" t2 ON t2.id = att2."B"
        WHERE att2."A" = a.id
        AND t2.id = ANY(ARRAY[${valuesArray}]::text[])
      )`;
    }
    default:
      return whereClause;
  }
}

// 2. Sorting
type DirectAssetField =
  | "id"
  | "sequentialId"
  | "name"
  | "valuation"
  | "status"
  | "description"
  | "createdAt"
  | "updatedAt"
  | "availableToBook";

const directAssetFields: Record<DirectAssetField, string> = {
  id: "assetId",
  sequentialId: "assetSequentialId",
  name: "assetTitle",
  valuation: "assetValue",
  status: "assetStatus",
  description: "assetDescription",
  createdAt: "assetCreatedAt",
  updatedAt: "assetUpdatedAt",
  availableToBook: "assetAvailableToBook",
};

/**
 * Generates a PostgreSQL expression for natural sorting of text values
 * Handles case-insensitive comparison and natural number ordering.
 * What is natural sorting? https://en.wikipedia.org/wiki/Natural_sort_order
 * - Ignore case (treat uppercase and lowercase the same) 
 * - Sort numbers as whole values rather than character-by-character 
 * - Place purely alphabetic entries before alphanumeric ones
 
 * @param columnRef - The column or expression to sort
 * @param direction - Sort direction ('asc' or 'desc')
 * @returns SQL string with normalized sorting expression
 */
function getNormalizedSortExpression(
  columnRef: string,
  direction: string
): string {
  return `
    LOWER(regexp_replace(${columnRef}, '([0-9]+)', 
      lpad(regexp_replace(regexp_replace('\\1', '^0+', ''), '^$', '0'), 12, '0')
    )) ${direction},
    ${columnRef} ${direction}
  `.trim();
}

function getSequentialIdSortExpression(
  columnRef: string,
  direction: string
): string {
  return `
    CASE 
      WHEN ${columnRef} IS NULL THEN 1
      ELSE 0
    END ASC,
    CASE 
      WHEN ${columnRef} ~ '^[A-Z]+-[0-9]+$' 
      THEN LPAD(SPLIT_PART(${columnRef}, '-', 2), 12, '0')
      ELSE ${columnRef}
    END ${direction},
    ${columnRef} ${direction}
  `.trim();
}

/**
 * Enhanced sorting options parser with natural sort support
 * Handles case-insensitive sorting with natural number ordering
 * @param sortBy - Array of sort specifications in format: field:direction[:fieldType]
 * @returns Object containing SQL order by clause and custom field sorting info
 */
export function parseSortingOptions(sortBy: string[]): {
  orderByClause: string;
  customFieldSortings: CustomFieldSorting[];
} {
  const fields = sortBy.map((s) => {
    const [name, direction, fieldType] = s.split(":");
    return { name, direction, fieldType } as {
      name: string;
      direction: "asc" | "desc";
      fieldType: CustomFieldType;
    };
  });

  const orderByParts: string[] = [];
  const customFieldSortings: CustomFieldSorting[] = [];

  for (const field of fields) {
    if (field.name in directAssetFields) {
      const columnName = directAssetFields[field.name as DirectAssetField];

      // Special handling for sequential ID sorting
      if (field.name === "sequentialId") {
        orderByParts.push(
          getSequentialIdSortExpression(`"${columnName}"`, field.direction)
        );
      } else if (isTextColumn(field.name)) {
        // Apply natural sort for other text columns
        orderByParts.push(
          getNormalizedSortExpression(`"${columnName}"`, field.direction)
        );
      } else {
        // Use regular sorting for non-text columns
        orderByParts.push(`"${columnName}" ${field.direction}`);
      }
    } else if (field.name === "qrId") {
      orderByParts.push(getNormalizedSortExpression(`"qrId"`, field.direction));
    } else if (field.name === "kit") {
      orderByParts.push(
        getNormalizedSortExpression(`"kitName"`, field.direction)
      );
    } else if (field.name === "category") {
      orderByParts.push(
        getNormalizedSortExpression(`"categoryName"`, field.direction)
      );
    } else if (field.name === "location") {
      orderByParts.push(
        getNormalizedSortExpression(`"locationName"`, field.direction)
      );
    } else if (field.name === "custody") {
      orderByParts.push(
        getNormalizedSortExpression(`custody->>'name'`, field.direction)
      );
    } else if (field.name.startsWith("barcode_")) {
      // Handle barcode column sorting
      const barcodeType = field.name.replace("barcode_", "");
      orderByParts.push(
        getNormalizedSortExpression(`barcode_${barcodeType}`, field.direction)
      );
    } else if (field.name.startsWith("cf_")) {
      const customFieldName = field.name.slice(3);
      const alias = `cf_${customFieldName.replace(/\s+/g, "_")}`;
      customFieldSortings.push({
        name: customFieldName,
        valueKey: "raw",
        alias,
        fieldType: field.fieldType,
      });

      // Apply sort based on custom field type
      if (field.fieldType === "DATE" || field.fieldType === "BOOLEAN") {
        // Direct sort for dates and booleans
        orderByParts.push(`${alias} ${field.direction}`);
      } else if (field.fieldType === "AMOUNT") {
        orderByParts.push(`${alias}::numeric ${field.direction}`);
      } else {
        // Natural sort for text-based custom fields
        orderByParts.push(getNormalizedSortExpression(alias, field.direction));
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn(`Unknown sort field: ${field.name}`);
    }
  }
  if (orderByParts.length === 0) {
    // Default sort: Most recent assets first, with stable secondary sort by ID
    // This provides a logical default while ensuring deterministic results
    orderByParts.push(
      '"assetCreatedAt" DESC', // Primary: Newest assets first
      '"assetId" ASC' // Secondary: Stable sort for identical timestamps
    );
  }

  // Always generate an ORDER BY clause for predictable results
  const orderByClause: string = `ORDER BY ${orderByParts.join(", ")}`;

  return { orderByClause, customFieldSortings };
}

/**
 * Helper function to determine if a field should use text-based natural sorting
 * @param fieldName - Name of the field being sorted
 * @returns boolean indicating if field should use natural sort
 */
function isTextColumn(fieldName: string): boolean {
  const textColumns: DirectAssetField[] = [
    "sequentialId",
    "name",
    "description",
  ];
  return textColumns.includes(fieldName as DirectAssetField);
}

export function generateCustomFieldSelect(
  customFieldSortings: CustomFieldSorting[]
): Prisma.Sql {
  if (customFieldSortings.length === 0) return Prisma.empty;

  return Prisma.sql`, ${Prisma.join(
    customFieldSortings.map(
      (cf) =>
        Prisma.sql`(
      SELECT 
        CASE ${cf.fieldType}
          WHEN 'DATE' THEN 
            (acfv.value->>'valueDate')::timestamp::text
          WHEN 'BOOLEAN' THEN 
            (acfv.value->>'valueBoolean')::boolean::text
          WHEN 'MULTILINE_TEXT' THEN
            (acfv.value->>'valueMultiLineText')::text
          WHEN 'OPTION' THEN
            (acfv.value->>'valueOption')::text
          ELSE
            acfv.value->>'raw'
        END
      FROM public."AssetCustomFieldValue" acfv
      JOIN public."CustomField" cf ON acfv."customFieldId" = cf.id
      WHERE acfv."assetId" = a.id AND cf.name = ${cf.name}
    ) AS ${Prisma.raw(cf.alias)}`
    )
  )}`;
}

// 3. Data

// TypeScript types for options
export type AssetQueryOptions = {
  withBookings?: boolean;
  withBarcodes?: boolean;
};

export type AssetReturnOptions = {
  withBookings?: boolean;
  withBarcodes?: boolean;
};

// Convert to functions that accept options
export const assetQueryFragment = (options: AssetQueryOptions = {}) => {
  const { withBookings = false, withBarcodes = false } = options;

  const bookingsSelect = withBookings
    ? Prisma.sql`,
    (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', bk.id,
            'name', bk.name,
            'status', bk.status,
            'from', bk."from",
            'to', bk."to",
            'description', bk.description,
            'tags', (
              SELECT COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'id', t.id,
                    'name', t.name
                  )
                ),
                '[]'::jsonb
              )
              FROM public."_BookingToTag" btt
              JOIN public."Tag" t ON btt."B" = t.id
              WHERE btt."A" = bk.id
            ),
            'custodianTeamMember', CASE 
              WHEN bk."custodianTeamMemberId" IS NOT NULL THEN
                jsonb_build_object(
                  'id', ctm.id,
                  'name', ctm.name,
                  'user', CASE 
                    WHEN ctm."userId" IS NOT NULL THEN
                      jsonb_build_object(
                        'id', ctmu.id,
                        'firstName', ctmu."firstName",
                        'lastName', ctmu."lastName",
                        'email', ctmu.email,
                        'profilePicture', ctmu."profilePicture"
                      )
                    ELSE NULL
                  END
                )
              ELSE NULL
            END,
            'custodianUser', CASE 
              WHEN bk."custodianUserId" IS NOT NULL THEN
                jsonb_build_object(
                  'id', cu.id,
                  'firstName', cu."firstName",
                  'lastName', cu."lastName",
                  'email', cu.email,
                  'profilePicture', cu."profilePicture"
                )
              ELSE NULL
            END,
            'creator', CASE 
              WHEN bk."creatorId" IS NOT NULL THEN
                jsonb_build_object(
                  'id', cr.id,
                  'firstName', cr."firstName",
                  'lastName', cr."lastName",
                  'profilePicture', cr."profilePicture"
                )
              ELSE NULL
            END
          )
        ),
        '[]'::jsonb
      )
      FROM public."_AssetToBooking" atb
      JOIN public."Booking" bk ON atb."B" = bk.id
      LEFT JOIN public."TeamMember" ctm ON bk."custodianTeamMemberId" = ctm.id
      LEFT JOIN public."User" ctmu ON ctm."userId" = ctmu.id
      LEFT JOIN public."User" cu ON bk."custodianUserId" = cu.id
      LEFT JOIN public."User" cr ON bk."creatorId" = cr.id
      WHERE 
        atb."A" = a.id 
        AND bk.status IN ('RESERVED', 'ONGOING', 'OVERDUE')
    ) AS bookings`
    : Prisma.sql``;

  const barcodesSelect = withBarcodes
    ? Prisma.sql`,
    (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', b.id,
            'type', b.type,
            'value', b.value
          )
        ),
        '[]'::jsonb
      )
      FROM public."Barcode" b
      WHERE b."assetId" = a.id
    ) AS barcodes,
    (
      SELECT b.value
      FROM public."Barcode" b
      WHERE b."assetId" = a.id AND b.type = 'Code128'
      LIMIT 1
    ) AS barcode_Code128,
    (
      SELECT b.value
      FROM public."Barcode" b
      WHERE b."assetId" = a.id AND b.type = 'Code39'
      LIMIT 1
    ) AS barcode_Code39,
    (
      SELECT b.value
      FROM public."Barcode" b
      WHERE b."assetId" = a.id AND b.type = 'DataMatrix'
      LIMIT 1
    ) AS barcode_DataMatrix,
    (
      SELECT b.value
      FROM public."Barcode" b
      WHERE b."assetId" = a.id AND b.type = 'ExternalQR'
      LIMIT 1
    ) AS barcode_ExternalQR,
    (
      SELECT b.value
      FROM public."Barcode" b
      WHERE b."assetId" = a.id AND b.type = 'EAN13'
      LIMIT 1
    ) AS barcode_EAN13`
    : Prisma.sql``;

  return Prisma.sql`
    SELECT 
      a.id AS "assetId",
      (
        SELECT q.id
        FROM public."Qr" q
        WHERE q."assetId" = a.id
        LIMIT 1
      ) AS "qrId",
      a.title AS "assetTitle",
      a.description AS "assetDescription",
      a."sequentialId" AS "assetSequentialId",
      a."createdAt" AS "assetCreatedAt",
      a."updatedAt" AS "assetUpdatedAt",
      a."userId" AS "assetUserId",
      a."mainImage" AS "assetMainImage",
      a."thumbnailImage" AS "assetThumbnailImage",
      a."mainImageExpiration" AS "assetMainImageExpiration",
      a."locationId" AS "assetLocationId",
      a."organizationId" AS "assetOrganizationId",
      a.status AS "assetStatus",
      a.value AS "assetValue",
      a."availableToBook" AS "assetAvailableToBook",
      a."kitId" AS "assetKitId",
      a."categoryId" AS "assetCategoryId",
      k.id AS "kitId",
      k.name AS "kitName",
      k.status AS "kitStatus",
      c.id AS "categoryId",
      c.name AS "categoryName",
      c.color AS "categoryColor",
      l."parentId" AS "locationParentId",
      CASE
        WHEN l.id IS NOT NULL THEN (
          SELECT COUNT(*)::integer
          FROM public."Location" lc
          WHERE lc."parentId" = l.id
        )
        ELSE 0
      END AS "locationChildCount",
      CASE 
        WHEN l.name IS NOT NULL THEN l.name
        ELSE NULL
      END AS "locationName",
      COALESCE(
        jsonb_agg(
          DISTINCT jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
        ) FILTER (WHERE t.id IS NOT NULL),
        '[]'::jsonb
      ) AS tags,
      COALESCE(
        CASE 
          WHEN cu.id IS NOT NULL THEN
            jsonb_build_object(
              'name', tm.name,
              'custodian', jsonb_build_object(
                'name', tm.name,
                'user', CASE 
                  WHEN u.id IS NOT NULL THEN
                    jsonb_build_object(
                      'id', u.id,
                      'firstName', u."firstName",
                      'lastName', u."lastName",
                      'profilePicture', u."profilePicture",
                      'email', u.email
                    )
                  ELSE NULL
                END
              )
            )
          WHEN b.id IS NOT NULL THEN
            jsonb_build_object(
              'name', COALESCE(CONCAT(bu."firstName", ' ', bu."lastName"), btm.name),
              'custodian', jsonb_build_object(
                'name', COALESCE(CONCAT(bu."firstName", ' ', bu."lastName"), btm.name),
                'user', CASE 
                  WHEN bu.id IS NOT NULL THEN
                    jsonb_build_object(
                      'id', u.id,
                      'firstName', bu."firstName",
                      'lastName', bu."lastName",
                      'profilePicture', bu."profilePicture",
                      'email', bu.email
                    )
                  ELSE NULL
                END
              )
            )
          ELSE NULL
        END,
        NULL
      ) AS custody,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', acfv.id,
            'value', acfv.value,
            'customField', jsonb_build_object(
              'id', cf.id,
              'name', cf.name,
              'helpText', cf."helpText",
              'required', cf.required,
              'type', cf.type,
              'options', cf.options,
              'categories', (
                SELECT jsonb_agg(jsonb_build_object('id', cat.id, 'name', cat.name))
                FROM public."_CategoryToCustomField" ccf
                JOIN public."Category" cat ON ccf."A" = cat.id
                WHERE ccf."B" = cf.id
              )
            )
          )
        )
        FROM public."AssetCustomFieldValue" acfv
        JOIN public."CustomField" cf ON acfv."customFieldId" = cf.id
        WHERE acfv."assetId" = a.id AND cf.active = true
      ) AS "customFields",
      (
        SELECT jsonb_build_object(
          'id', ar.id,
          'name', ar.name,
          'message', ar.message,
          'alertDateTime', ar."alertDateTime"
        )
        FROM public."AssetReminder" ar
        WHERE 
          ar."assetId" = a.id 
          AND ar."alertDateTime" >= NOW() AT TIME ZONE 'UTC'
        ORDER BY 
          ar."alertDateTime" ASC
        LIMIT 1
      ) AS upcomingReminder${bookingsSelect}${barcodesSelect}
  `;
};

export const assetQueryJoins = Prisma.sql`
  FROM public."Asset" a
  LEFT JOIN public."Kit" k ON a."kitId" = k.id
  LEFT JOIN public."Category" c ON a."categoryId" = c.id
  LEFT JOIN public."Location" l ON a."locationId" = l.id
  LEFT JOIN public."_AssetToTag" att ON a.id = att."A"
  LEFT JOIN public."Tag" t ON att."B" = t.id
  LEFT JOIN public."Custody" cu ON cu."assetId" = a.id
  LEFT JOIN public."TeamMember" tm ON cu."teamMemberId" = tm.id
  LEFT JOIN public."User" u ON tm."userId" = u.id
  LEFT JOIN LATERAL (
    SELECT b.*
    FROM public."Booking" b
    JOIN public."_AssetToBooking" atb ON b.id = atb."B" AND a.id = atb."A"
    WHERE b.status IN ('ONGOING', 'OVERDUE')
    LIMIT 1
  ) b ON TRUE
  LEFT JOIN public."User" bu ON b."custodianUserId" = bu.id
  LEFT JOIN public."TeamMember" btm ON b."custodianTeamMemberId" = btm.id
`;

/**
 * Returns SQL fragment for building assets array, ensuring proper handling of empty results
 * @param {AssetReturnOptions} options - Options for the return fragment
 * @param {boolean} options.withBookings - Whether to include bookings in the result
 * @returns Prisma.Sql fragment that safely handles no results
 */
export const assetReturnFragment = (options: AssetReturnOptions = {}) => {
  const { withBookings = false, withBarcodes = false } = options;

  const bookingsField = withBookings
    ? Prisma.sql`,
        'bookings', COALESCE(aq.bookings, '[]'::jsonb)`
    : Prisma.sql``;

  const barcodesField = withBarcodes
    ? Prisma.sql`,
        'barcodes', COALESCE(aq.barcodes, '[]'::jsonb)`
    : Prisma.sql``;

  return Prisma.sql`
    COALESCE(
      json_agg(
        jsonb_build_object(
          'id', aq."assetId",
          'sequentialId', aq."assetSequentialId",
          'qrId', aq."qrId",
          'title', aq."assetTitle",
          'description', aq."assetDescription",
          'createdAt', aq."assetCreatedAt",
          'updatedAt', aq."assetUpdatedAt",
          'userId', aq."assetUserId", 
          'mainImage', aq."assetMainImage",
          'thumbnailImage', aq."assetThumbnailImage",
          'mainImageExpiration', aq."assetMainImageExpiration",
          'categoryId', aq."assetCategoryId",
          'locationId', aq."assetLocationId",
          'organizationId', aq."assetOrganizationId",
          'status', aq."assetStatus",
          'valuation', aq."assetValue",
          'availableToBook', aq."assetAvailableToBook",
          'kitId', aq."assetKitId",
          'kit', CASE WHEN aq."kitId" IS NOT NULL THEN jsonb_build_object('id', aq."kitId", 'name', aq."kitName", 'status', aq."kitStatus") ELSE NULL END,
          'category', CASE WHEN aq."categoryId" IS NOT NULL THEN jsonb_build_object('id', aq."categoryId", 'name', aq."categoryName", 'color', aq."categoryColor") ELSE NULL END,
          'tags', aq.tags,
          'location', CASE 
            WHEN aq."assetLocationId" IS NOT NULL THEN jsonb_build_object(
              'id', aq."assetLocationId",
              'name', aq."locationName",
              'parentId', aq."locationParentId",
              'childCount', aq."locationChildCount"
            )
            ELSE NULL
          END,
          'custody', aq.custody,
          'customFields', COALESCE(aq."customFields", '[]'::jsonb),
          'upcomingReminder', aq.upcomingReminder${bookingsField}${barcodesField}
        )
      ) FILTER (WHERE aq."assetId" IS NOT NULL),
      '[]'
    ) AS assets
  `;
};

export async function parseFiltersWithHierarchy(
  filtersString: string,
  columns: Column[],
  organizationId?: string
): Promise<Filter[]> {
  const parsed = parseFilters(filtersString, columns);
  if (!organizationId) return parsed;
  return expandLocationHierarchyFilters({ filters: parsed, organizationId });
}
