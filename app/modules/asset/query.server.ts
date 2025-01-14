import { Prisma, CustomFieldType } from "@prisma/client";

import type {
  Filter,
  FilterOperator,
} from "~/components/assets/assets-index/advanced-filters/schema";
import type { CustomFieldSorting } from "./types";
import type { Column } from "../asset-index-settings/helpers";

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
  assetIds?: string[]
): Prisma.Sql {
  let whereClause = Prisma.sql`WHERE a."organizationId" = ${organizationId}`;

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
      // Create OR conditions for each search term
      const searchConditions = words.map(
        (term) => Prisma.sql`a.title ILIKE ${`%${term}%`}`
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
        if (["location", "kit", "category", "qrId"].includes(filter.name)) {
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
      const valuesArray = `{${values.map((v) => `"${v}"`).join(",")}}`;
      return Prisma.sql`${whereClause} AND ${subquery} = ANY(${valuesArray}::text[])`;
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
    case "between":
      const [start, end] = filter.value as [string, string];
      return Prisma.sql`${whereClause} AND (${subquery})::date BETWEEN ${start}::date AND ${end}::date`;
    case "inDates": {
      const dates = (filter.value as string).split(",").map((d) => d.trim());
      const datesArray = `{${dates.map((d) => `"${d}"`).join(",")}}`;
      return Prisma.sql`${whereClause} AND (${subquery})::date = ANY(${datesArray}::date[])`;
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
      const valuesArray = `{${values.map((v) => `"${v}"`).join(",")}}`;
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(
        filter.name
      )}" = ANY(${valuesArray}::text[])`;
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
    case "between":
      const [min, max] = filter.value as [number, number];
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(
        filter.name
      )}" BETWEEN ${min} AND ${max}`;
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
    case "between":
      const [start, end] = filter.value as [string, string];
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(
        filter.name
      )}" BETWEEN ${start}::date AND ${end}::date`;
    case "inDates": {
      // Split comma-separated dates and remove whitespace
      const dates = (filter.value as string).split(",").map((d) => d.trim());
      // Create array literal for Postgres
      const datesArray = `{${dates.map((d) => `"${d}"`).join(",")}}`;
      return Prisma.sql`${whereClause} AND a."${Prisma.raw(
        filter.name
      )}"::date = ANY(${datesArray}::date[])`;
    }
    default:
      return whereClause;
  }
}

function addEnumFilter(whereClause: Prisma.Sql, filter: Filter): Prisma.Sql {
  if (filter.name === "status") {
    // For containsAny, convert comma-separated string to array
    let trimmedValue;
    if (filter.operator === "containsAny") {
      const values = (filter.value as string).split(",").map((v) => v.trim());
      trimmedValue = `{${values.join(",")}}`;
    } else {
      // For other operators, use existing trimming logic
      if (Array.isArray(filter.value)) {
        trimmedValue = filter.value.map((val) =>
          typeof val === "string" ? val.trim() : val
        );
      } else if (typeof filter.value === "string") {
        trimmedValue = filter.value.trim();
      } else {
        trimmedValue = filter.value;
      }
    }

    switch (filter.operator) {
      case "is":
        return Prisma.sql`${whereClause} AND a.status = ${trimmedValue}::public."AssetStatus"`;
      case "isNot":
        return Prisma.sql`${whereClause} AND a.status != ${trimmedValue}::public."AssetStatus"`;
      case "containsAny":
        return Prisma.sql`${whereClause} AND a.status = ANY(${trimmedValue}::public."AssetStatus"[])`;
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

          const categoryIdsArray = `{${categoryIds.join(",")}}`;
          return Prisma.sql`${whereClause} AND (
            a."categoryId" IS NULL 
            OR EXISTS (
              SELECT 1 FROM public."Category"
              WHERE id = a."categoryId" AND id = ANY(${categoryIdsArray}::text[])
            )
          )`;
        }

        const categoryIdsArray = `{${values.join(",")}}`;
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."Category"
          WHERE id = a."categoryId" AND id = ANY(${categoryIdsArray}::text[])
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
        if (filter.value === "without-location") {
          return Prisma.sql`${whereClause} AND a."locationId" IS NULL`;
        }
        //Reference the Location table for name comparison
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."Location"
          WHERE id = a."locationId" AND id = ${filter.value}
        )`;

      case "isNot":
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

        if (values.includes("without-location")) {
          // Remove "without-location" from the values array
          const locationIds = values.filter((v) => v !== "without-location");

          if (locationIds.length === 0) {
            return Prisma.sql`${whereClause} AND a."locationId" IS NULL`;
          }

          const locationIdsArray = `{${locationIds.join(",")}}`;
          return Prisma.sql`${whereClause} AND (
            a."locationId" IS NULL 
            OR EXISTS (
              SELECT 1 FROM public."Location"
              WHERE id = a."locationId" AND id = ANY(${locationIdsArray}::text[])
            )
          )`;
        }

        const locationIdsArray = `{${values.join(",")}}`;
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."Location"
          WHERE id = a."locationId" AND id = ANY(${locationIdsArray}::text[])
        )`;
      }

      default:
        return whereClause;
    }
  }

  // Add location handling using asset's kitId since we're using LEFT JOIN
  if (filter.name === "kit") {
    switch (filter.operator) {
      case "is":
        if (filter.value === "without-kit") {
          return Prisma.sql`${whereClause} AND a."kitId" IS NULL`;
        }
        //Reference the Kit table for name comparison
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."Kit"
          WHERE id = a."kitId" AND id = ${filter.value}
        )`;

      case "isNot":
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

        if (values.includes("without-kit")) {
          // Remove "without-kit" from the values array
          const kitIds = values.filter((v) => v !== "without-kit");

          if (kitIds.length === 0) {
            return Prisma.sql`${whereClause} AND a."kitId" IS NULL`;
          }

          const kitIdsArray = `{${kitIds.join(",")}}`;
          return Prisma.sql`${whereClause} AND (
            a."kitId" IS NULL 
            OR EXISTS (
              SELECT 1 FROM public."Kit"
              WHERE id = a."kitId" AND id = ANY(${kitIdsArray}::text[])
            )
          )`;
        }

        const kitIdsArray = `{${values.join(",")}}`;
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."Kit"
          WHERE id = a."kitId" AND id = ANY(${kitIdsArray}::text[])
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
        const valuesArray = `{${values.map((v) => `"${v}"`).join(",")}}`;
        return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."Qr" q WHERE q."assetId" = a.id AND q.id = ANY(${valuesArray}::text[]))`;
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
      const valuesArray = `{${values.map((v) => `"${v}"`).join(",")}}`;
      return Prisma.sql`${whereClause} AND ${Prisma.raw(
        alias
      )}.name = ANY(${valuesArray}::text[])`;
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
      if (filter.value === "without-custody") {
        return Prisma.sql`${whereClause} AND cu.id IS NULL`;
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
      if (filter.value === "without-custody") {
        return Prisma.sql`${whereClause} AND cu.id IS NOT NULL`;
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

      if (values.includes("without-custody")) {
        // Remove "without-custody" from the values array
        const custodianIds = values.filter((v) => v !== "without-custody");

        if (custodianIds.length === 0) {
          return Prisma.sql`${whereClause} AND cu.id IS NULL`;
        }

        const custodianIdsArray = `{${custodianIds.join(",")}}`;
        return Prisma.sql`${whereClause} AND (
          cu.id IS NULL 
          OR EXISTS (
            SELECT 1 FROM "Custody" cu 
            WHERE cu."assetId" = a.id 
            AND cu."teamMemberId" = ANY(${custodianIdsArray}::text[])
          )
          OR EXISTS (
            SELECT 1 FROM "Booking" b 
            JOIN "_AssetToBooking" atb ON b.id = atb."B" AND a.id = atb."A"
            WHERE b.status IN ('ONGOING', 'OVERDUE')
            AND (
              b."custodianTeamMemberId" = ANY(${custodianIdsArray}::text[])
              OR b."custodianUserId" IN (
                SELECT "userId" FROM "TeamMember" tm 
                WHERE tm.id = ANY(${custodianIdsArray}::text[])
              )
            )
          )
        )`;
      }

      const custodianIdsArray = `{${values.join(",")}}`;
      return Prisma.sql`${whereClause} AND (
        EXISTS (
          SELECT 1 FROM "Custody" cu 
          WHERE cu."assetId" = a.id 
          AND cu."teamMemberId" = ANY(${custodianIdsArray}::text[])
        )
        OR EXISTS (
          SELECT 1 FROM "Booking" b 
          JOIN "_AssetToBooking" atb ON b.id = atb."B" AND a.id = atb."A"
          WHERE b.status IN ('ONGOING', 'OVERDUE')
          AND (
            b."custodianTeamMemberId" = ANY(${custodianIdsArray}::text[])
            OR b."custodianUserId" IN (
              SELECT "userId" FROM "TeamMember" tm 
              WHERE tm.id = ANY(${custodianIdsArray}::text[])
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
      // Single tag filtering using the existing join with case-insensitive comparison
      return Prisma.sql`${whereClause} AND LOWER(t.name) = LOWER(${filter.value})`;
    }
    case "containsAll": {
      // ALL tags must be present, case-insensitive
      const values = (filter.value as string).split(",").map((v) => v.trim());
      return Prisma.sql`${whereClause} AND NOT EXISTS (
        SELECT LOWER(unnest(${values}::text[])) AS required_tag
        EXCEPT
        SELECT LOWER(t.name)
        FROM "_AssetToTag" att 
        JOIN "Tag" t ON t.id = att."B"
        WHERE att."A" = a.id
      )`;
    }
    case "containsAny": {
      // ANY of the tags must be present, case-insensitive
      const values = (filter.value as string).split(",").map((v) => v.trim());
      const valuesArray = `{${values.map((v) => `"${v}"`).join(",")}}`;
      return Prisma.sql`${whereClause} AND LOWER(t.name) = ANY(ARRAY(SELECT LOWER(unnest(${valuesArray}::text[]))))`;
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

      const valuesArray = `{${values.map((v) => `"${v}"`).join(",")}}`;
      return Prisma.sql`${whereClause} AND NOT EXISTS (
        SELECT 1 
        FROM "_AssetToTag" att2
        JOIN "Tag" t2 ON t2.id = att2."B"
        WHERE att2."A" = a.id 
        AND t2.name = ANY(${valuesArray}::text[])
      )`;
    }
    default:
      return whereClause;
  }
}

// Add this mapping object at the top of your file
const API_TO_DB_FIELD_MAP: Record<string, string> = {
  valuation: "value",
};

/**
 * Parses a filter string into an array of Filter objects
 * @param filtersString - The string containing the filters
 * @returns An array of Filter objects
 */
export function parseFilters(
  filtersString: string,
  columns: Column[]
): Filter[] {
  const searchParams = new URLSearchParams(filtersString);
  const filters: Filter[] = [];

  searchParams.forEach((value, key) => {
    const column = columns.find((c) => c.name === key);
    if (column) {
      const [operator, filterValue] = value.split(":");
      const dbKey = API_TO_DB_FIELD_MAP[key] || key;

      const filter: Filter = {
        name: dbKey,
        type: key.startsWith("cf_") ? "customField" : getQueryFieldType(key),
        operator: operator as FilterOperator,
        value: parseFilterValue(
          key,
          operator as FilterOperator,
          filterValue,
          columns
        ),
        fieldType: column.cfType,
      };
      filters.push(filter);
    }
  });

  return filters;
}

/**
 * Represents how a field should be handled in SQL query construction
 */
export type QueryFieldType =
  | "string"
  | "text"
  | "boolean"
  | "date"
  | "number"
  | "enum"
  | "array"
  | "customField";

/**
 * Determines how a field should be handled in SQL query construction
 * Used for building WHERE clauses and query conditions
 *
 * @param fieldName - Name of the database field
 * @returns The query field type for SQL generation
 */
export function getQueryFieldType(fieldName: string): QueryFieldType {
  // Custom fields are handled separately in SQL construction
  if (fieldName.startsWith("cf_")) {
    return "customField";
  }

  switch (fieldName) {
    case "id":
    case "title":
    case "qrId": // relation
      return "string";
    case "status":
    case "custody":
    case "category": // relation
    case "location": // relation
    case "kit": // relation
      return "enum";
    case "description":
      return "text";
    case "valuation":
      return "number";
    case "availableToBook":
      return "boolean";
    case "createdAt":
    case "updatedAt":
      return "date";
    case "tags":
      return "array";
    default:
      return "string";
  }
}

/**
 * Parses the filter value based on the field type and operator
 * @param field - The name of the field
 * @param operator - The filter operator
 * @param value - The raw filter value
 * @returns The parsed filter value
 */
function parseFilterValue(
  field: string,
  operator: FilterOperator,
  value: string,
  columns: Column[]
): any {
  if (field.startsWith("cf_")) {
    const column = columns.find((c) => c.name === field);
    if (column && column.cfType) {
      switch (column.cfType) {
        case CustomFieldType.BOOLEAN:
          return value.toLowerCase() === "true";
        case CustomFieldType.DATE:
          return operator === "between" ? value.split(",") : value;
        default:
          return value;
      }
    }
  }

  switch (getQueryFieldType(field)) {
    case "number":
      return operator === "between"
        ? value.split(",").map(Number)
        : Number(value);
    case "boolean":
      return value.toLowerCase() === "true";
    case "date":
      return operator === "between" ? value.split(",") : value;
    case "enum":
      return operator === "in" ? value.split(",") : value;
    case "string":
    case "text":
      // For matchesAny and containsAny, keep as comma-separated string
      return value;
    default:
      return value;
  }
}

// 2. Sorting
type DirectAssetField =
  | "id"
  | "name"
  | "valuation"
  | "status"
  | "description"
  | "createdAt"
  | "availableToBook";

const directAssetFields: Record<DirectAssetField, string> = {
  id: "assetId",
  name: "assetTitle",
  valuation: "assetValue",
  status: "assetStatus",
  description: "assetDescription",
  createdAt: "assetCreatedAt",
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

      // Apply natural sort for text columns
      if (isTextColumn(field.name)) {
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
      } else {
        // Natural sort for text-based custom fields
        orderByParts.push(getNormalizedSortExpression(alias, field.direction));
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn(`Unknown sort field: ${field.name}`);
    }
  }

  const orderByClause =
    orderByParts.length > 0 ? `ORDER BY ${orderByParts.join(", ")}` : "";

  return { orderByClause, customFieldSortings };
}

/**
 * Helper function to determine if a field should use text-based natural sorting
 * @param fieldName - Name of the field being sorted
 * @returns boolean indicating if field should use natural sort
 */
function isTextColumn(fieldName: string): boolean {
  const textColumns: DirectAssetField[] = ["name", "description"];
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
export const assetQueryFragment = Prisma.sql`
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
    a."createdAt" AS "assetCreatedAt",
    a."updatedAt" AS "assetUpdatedAt",
    a."userId" AS "assetUserId",
    a."mainImage" AS "assetMainImage",
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
    c.id AS "categoryId",
    c.name AS "categoryName",
    c.color AS "categoryColor",
    CASE 
      WHEN l.name IS NOT NULL THEN l.name
      ELSE NULL
    END AS "locationName",
    COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', t.id, 'name', t.name)) FILTER (WHERE t.id IS NOT NULL), '[]'::jsonb) AS tags,
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
    ) AS upcomingReminder
`;

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

// 4. Return
export const assetReturnFragment = Prisma.sql`
  json_agg(
    jsonb_build_object(
      'id', aq."assetId",
      'qrId', aq."qrId",
      'title', aq."assetTitle",
      'description', aq."assetDescription",
      'createdAt', aq."assetCreatedAt",
      'updatedAt', aq."assetUpdatedAt",
      'userId', aq."assetUserId",
      'mainImage', aq."assetMainImage",
      'mainImageExpiration', aq."assetMainImageExpiration",
      'categoryId', aq."assetCategoryId",
      'locationId', aq."assetLocationId",
      'organizationId', aq."assetOrganizationId",
      'status', aq."assetStatus",
      'valuation', aq."assetValue",
      'availableToBook', aq."assetAvailableToBook",
      'kitId', aq."assetKitId",
      'kit', CASE WHEN aq."kitId" IS NOT NULL THEN jsonb_build_object('id', aq."kitId", 'name', aq."kitName") ELSE NULL END,
      'category', CASE WHEN aq."categoryId" IS NOT NULL THEN jsonb_build_object('id', aq."categoryId", 'name', aq."categoryName", 'color', aq."categoryColor") ELSE NULL END,
      'tags', aq.tags,
      'location', jsonb_build_object('name', aq."locationName"),
      'custody', aq.custody,
      'customFields', COALESCE(aq."customFields", '[]'::jsonb),
      'upcomingReminder', aq.upcomingReminder
    )
  ) AS assets
`;
