import { Prisma } from "@prisma/client";
import type { CustomFieldType } from "@prisma/client";

import type { BarcodeType } from "@prisma/client";

import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import { normalizeBarcodeValue } from "~/modules/barcode/validation";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { isSafeSqlIdentifier } from "~/utils/sql";
import { parseFilters } from "./filter-parsing";
import { expandLocationHierarchyFilters } from "./location-filter.server";
import type { CustomFieldSorting } from "./types";
import type { Column } from "../asset-index-settings/helpers";

/**
 * SQL fragment: checks that the asset status is CHECKED_OUT.
 * Used to guard booking-based custody so that partially checked-in
 * assets are not incorrectly shown as "in custody".
 */
const ASSET_IS_CHECKED_OUT = Prisma.sql`a.status = 'CHECKED_OUT'`;

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
          EXISTS (
            -- Tag-name search. Rewritten from the fanning join on
            -- _AssetToTag + Tag with t.name ILIKE (which was the sole reason
            -- the outer query needed a GROUP BY) to a per-asset EXISTS, so
            -- the slim pagination phase can drop the tag joins and the GROUP
            -- BY entirely. Any-tag-match semantics are preserved: the asset
            -- matches iff at least one of its tags' names ILIKE the term
            -- (EXISTS dedups the same way GROUP BY did).
            SELECT 1 FROM public."_AssetToTag" att
            JOIN public."Tag" t ON att."B" = t.id
            WHERE att."A" = a.id AND t.name ILIKE ${`%${term}%`}
          ) OR
          EXISTS (
            -- Custodian search. Custody moved to the custody_agg LATERAL
            -- (multi-custodian), so there is no top-level tm/u join to
            -- reference here — match against ALL of the asset's
            -- custodians via a per-asset scoped subquery instead.
            SELECT 1 FROM public."Custody" cust
            LEFT JOIN public."TeamMember" ctm ON cust."teamMemberId" = ctm.id
            LEFT JOIN public."User" cusr ON ctm."userId" = cusr.id
            WHERE cust."assetId" = a.id AND (
              ctm.name ILIKE ${`%${term}%`} OR
              cusr."firstName" ILIKE ${`%${term}%`} OR
              cusr."lastName" ILIKE ${`%${term}%`}
            )
          ) OR
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
  /**
   * Cast the column to float for comparison. This handles both Float columns
   * (valuation) and Int columns (quantity) uniformly, and avoids the
   * "operator does not exist: integer = text" error from Prisma's
   * parameterized queries sending values as text.
   */
  const col = Prisma.raw(filter.name);
  const val = Number(filter.value);
  switch (filter.operator) {
    case "is":
      return Prisma.sql`${whereClause} AND a."${col}"::float = ${val}`;
    case "isNot":
      return Prisma.sql`${whereClause} AND a."${col}"::float != ${val}`;
    case "gt":
      return Prisma.sql`${whereClause} AND a."${col}"::float > ${val}`;
    case "lt":
      return Prisma.sql`${whereClause} AND a."${col}"::float < ${val}`;
    case "gte":
      return Prisma.sql`${whereClause} AND a."${col}"::float >= ${val}`;
    case "lte":
      return Prisma.sql`${whereClause} AND a."${col}"::float <= ${val}`;
    case "between": {
      const [min, max] = filter.value as [number, number];
      return Prisma.sql`${whereClause} AND a."${col}"::float BETWEEN ${Number(
        min
      )} AND ${Number(max)}`;
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

  // Handle asset type enum (Individual vs Quantity Tracked)
  if (filter.name === "type") {
    switch (filter.operator) {
      case "is": {
        whereClause = Prisma.sql`${whereClause} AND a."type" = ${filter.value}::public."AssetType"`;
        break;
      }
      case "isNot": {
        whereClause = Prisma.sql`${whereClause} AND a."type" != ${filter.value}::public."AssetType"`;
        break;
      }
      default:
        break;
    }
    return whereClause;
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

        // An empty category set matches no assets. Guard before
        // `Prisma.join([])` (which throws) — same crash class as
        // SHELF-WEBAPP-1MY on the location branch.
        if (values.length === 0) {
          return Prisma.sql`${whereClause} AND 1=0`;
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

  // Location handling — an asset's placement lives on the `AssetLocation`
  // pivot (qty-tracked can be at many locations; INDIVIDUAL capped at one
  // by trigger). EXISTS checks against AssetLocation give a yes/no answer
  // per asset without fan-out.
  if (filter.name === "location") {
    switch (filter.operator) {
      case "is":
        if (filter.value === "in-location") {
          return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."AssetLocation" al WHERE al."assetId" = a.id)`;
        }
        if (filter.value === "without-location") {
          return Prisma.sql`${whereClause} AND NOT EXISTS (SELECT 1 FROM public."AssetLocation" al WHERE al."assetId" = a.id)`;
        }
        // Match assets placed at the specified location via AssetLocation.
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."AssetLocation" al
          WHERE al."assetId" = a.id AND al."locationId" = ${filter.value}
        )`;

      case "isNot":
        if (filter.value === "in-location") {
          return Prisma.sql`${whereClause} AND NOT EXISTS (SELECT 1 FROM public."AssetLocation" al WHERE al."assetId" = a.id)`;
        }
        if (filter.value === "without-location") {
          return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."AssetLocation" al WHERE al."assetId" = a.id)`;
        }
        return Prisma.sql`${whereClause} AND NOT EXISTS (
          SELECT 1 FROM public."AssetLocation" al
          WHERE al."assetId" = a.id AND al."locationId" = ${filter.value}
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
          return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."AssetLocation" al WHERE al."assetId" = a.id)`;
        }

        // Handle "without-location" - assets that don't have a location
        if (hasWithoutLocation) {
          const locationIds = values.filter((v) => v !== "without-location");

          if (locationIds.length === 0) {
            return Prisma.sql`${whereClause} AND NOT EXISTS (SELECT 1 FROM public."AssetLocation" al WHERE al."assetId" = a.id)`;
          }

          const locationIdsArray = Prisma.join(
            locationIds.map((id) => Prisma.sql`${id}`),
            ", "
          );
          return Prisma.sql`${whereClause} AND (
            NOT EXISTS (SELECT 1 FROM public."AssetLocation" al WHERE al."assetId" = a.id)
            OR EXISTS (
              SELECT 1 FROM public."AssetLocation" al
              WHERE al."assetId" = a.id AND al."locationId" = ANY(ARRAY[${locationIdsArray}]::text[])
            )
          )`;
        }

        // An empty location set matches no assets. This happens when a
        // `withinHierarchy` filter is expanded against a deleted/stale location
        // whose descendant lookup returns no ids (SHELF-WEBAPP-1MY). Guard here
        // so we never call `Prisma.join([])`, which throws and 500s the whole
        // /assets index.
        if (values.length === 0) {
          return Prisma.sql`${whereClause} AND 1=0`;
        }

        const locationIdsArray = Prisma.join(
          values.map((id) => Prisma.sql`${id}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."AssetLocation" al
          WHERE al."assetId" = a.id AND al."locationId" = ANY(ARRAY[${locationIdsArray}]::text[])
        )`;
      }

      default:
        return whereClause;
    }
  }

  // Add asset model handling using asset's assetModelId
  if (filter.name === "assetModel") {
    switch (filter.operator) {
      case "is":
        if (filter.value === "without-model") {
          return Prisma.sql`${whereClause} AND a."assetModelId" IS NULL`;
        }
        return Prisma.sql`${whereClause} AND a."assetModelId" = ${filter.value}`;

      case "isNot":
        if (filter.value === "without-model") {
          return Prisma.sql`${whereClause} AND a."assetModelId" IS NOT NULL`;
        }
        return Prisma.sql`${whereClause} AND (a."assetModelId" IS NULL OR a."assetModelId" != ${filter.value})`;

      case "containsAny": {
        const values = (
          typeof filter.value === "string"
            ? filter.value.split(",").map((v) => v.trim())
            : Array.isArray(filter.value)
            ? filter.value
            : [filter.value]
        ).filter(Boolean);

        const hasWithoutModel = values.includes("without-model");
        const modelIds = values.filter((v) => v !== "without-model");

        if (hasWithoutModel && modelIds.length > 0) {
          const modelIdsArray = Prisma.join(
            modelIds.map((id) => Prisma.sql`${id}`),
            ", "
          );
          return Prisma.sql`${whereClause} AND (a."assetModelId" IS NULL OR a."assetModelId" = ANY(ARRAY[${modelIdsArray}]::text[]))`;
        } else if (hasWithoutModel) {
          return Prisma.sql`${whereClause} AND a."assetModelId" IS NULL`;
        } else if (modelIds.length > 0) {
          const modelIdsArray = Prisma.join(
            modelIds.map((id) => Prisma.sql`${id}`),
            ", "
          );
          return Prisma.sql`${whereClause} AND a."assetModelId" = ANY(ARRAY[${modelIdsArray}]::text[])`;
        }
        return whereClause;
      }

      default:
        return whereClause;
    }
  }

  // Add upcomingBookings handling to filter by booking ID
  if (filter.name === "upcomingBookings") {
    return addUpcomingBookingsFilter(whereClause, filter);
  }

  // Kit handling — an asset's kit membership lives on the `AssetKit`
  // pivot. `@@unique([assetId])` enforces "at most one kit per asset",
  // so EXISTS checks against AssetKit give a yes/no answer per asset.
  if (filter.name === "kit") {
    switch (filter.operator) {
      case "is":
        if (filter.value === "in-kit") {
          return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."AssetKit" ak WHERE ak."assetId" = a.id)`;
        }
        if (filter.value === "without-kit") {
          return Prisma.sql`${whereClause} AND NOT EXISTS (SELECT 1 FROM public."AssetKit" ak WHERE ak."assetId" = a.id)`;
        }
        // Match assets linked to the specified kit via AssetKit.
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."AssetKit" ak
          WHERE ak."assetId" = a.id AND ak."kitId" = ${filter.value}
        )`;

      case "isNot":
        if (filter.value === "in-kit") {
          return Prisma.sql`${whereClause} AND NOT EXISTS (SELECT 1 FROM public."AssetKit" ak WHERE ak."assetId" = a.id)`;
        }
        if (filter.value === "without-kit") {
          return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."AssetKit" ak WHERE ak."assetId" = a.id)`;
        }
        return Prisma.sql`${whereClause} AND NOT EXISTS (
          SELECT 1 FROM public."AssetKit" ak
          WHERE ak."assetId" = a.id AND ak."kitId" = ${filter.value}
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
          return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."AssetKit" ak WHERE ak."assetId" = a.id)`;
        }

        // Handle "without-kit" - assets that are not in a kit
        if (hasWithoutKit) {
          const kitIds = values.filter((v) => v !== "without-kit");

          if (kitIds.length === 0) {
            return Prisma.sql`${whereClause} AND NOT EXISTS (SELECT 1 FROM public."AssetKit" ak WHERE ak."assetId" = a.id)`;
          }

          const kitIdsArray = Prisma.join(
            kitIds.map((id) => Prisma.sql`${id}`),
            ", "
          );
          return Prisma.sql`${whereClause} AND (
            NOT EXISTS (SELECT 1 FROM public."AssetKit" ak WHERE ak."assetId" = a.id)
            OR EXISTS (
              SELECT 1 FROM public."AssetKit" ak
              WHERE ak."assetId" = a.id AND ak."kitId" = ANY(ARRAY[${kitIdsArray}]::text[])
            )
          )`;
        }

        // An empty kit set matches no assets. Guard before `Prisma.join([])`
        // (which throws) — same crash class as SHELF-WEBAPP-1MY.
        if (values.length === 0) {
          return Prisma.sql`${whereClause} AND 1=0`;
        }

        const kitIdsArray = Prisma.join(
          values.map((id) => Prisma.sql`${id}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."AssetKit" ak
          WHERE ak."assetId" = a.id AND ak."kitId" = ANY(ARRAY[${kitIdsArray}]::text[])
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

    // Normalize the filter value the SAME way the value is stored
    // (`normalizeBarcodeValue`): ExternalQR preserves its original case while
    // every other type is uppercased. Unconditionally uppercasing here broke
    // exact-match operators (is/isNot/matchesAny) for ExternalQR, whose codes
    // are stored case-sensitively, so `b.value = '813E1AE5'` never matched a
    // stored '813e1ae5'. (contains/containsAny were unaffected — ILIKE is
    // case-insensitive.)
    const normalizeForType = (value: string) =>
      normalizeBarcodeValue(barcodeType as BarcodeType, value);

    const normalizedValue =
      typeof filter.value === "string"
        ? normalizeForType(filter.value)
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
          .map((v) => normalizeForType(v.trim()));
        const valuesArray = Prisma.join(
          values.map((v) => Prisma.sql`${v}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND EXISTS (SELECT 1 FROM public."Barcode" b WHERE b."assetId" = a.id AND b.type::text = ${barcodeType} AND b.value = ANY(ARRAY[${valuesArray}]::text[]))`;
      }
      case "containsAny": {
        const values = (filter.value as string)
          .split(",")
          .map((v) => normalizeForType(v.trim()));
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
        // Only count booking custody when asset is still CHECKED_OUT
        // (partially checked-in assets should not show as in custody)
        return Prisma.sql`${whereClause} AND (
          jsonb_array_length(custody_agg.custody) > 0
          OR (${ASSET_IS_CHECKED_OUT} AND EXISTS (
            SELECT 1 FROM "Booking" b
            JOIN "BookingAsset" atb ON b.id = atb."bookingId" AND a.id = atb."assetId"
            WHERE b.status IN ('ONGOING', 'OVERDUE')
          ))
        )`;
      }
      if (filter.value === "without-custody") {
        // Exclude both direct custody and active booking custody
        return Prisma.sql`${whereClause} AND jsonb_array_length(custody_agg.custody) = 0 AND NOT (
          ${ASSET_IS_CHECKED_OUT} AND EXISTS (
            SELECT 1 FROM "Booking" b
            JOIN "BookingAsset" atb ON b.id = atb."bookingId" AND a.id = atb."assetId"
            WHERE b.status IN ('ONGOING', 'OVERDUE')
          )
        )`;
      }
      return Prisma.sql`${whereClause} AND (
        EXISTS (
          SELECT 1 FROM "Custody" cu
          WHERE cu."assetId" = a.id
          AND cu."teamMemberId" = ${filter.value}
        )
        OR (${ASSET_IS_CHECKED_OUT} AND EXISTS (
          SELECT 1 FROM "Booking" b
          JOIN "BookingAsset" atb ON b.id = atb."bookingId" AND a.id = atb."assetId"
          WHERE b.status IN ('ONGOING', 'OVERDUE')
          AND (
            b."custodianTeamMemberId" = ${filter.value}
            OR b."custodianUserId" = (
              SELECT "userId" FROM "TeamMember" tm WHERE tm.id = ${filter.value}
            )
          )
        ))
      )`;

    case "isNot":
      if (filter.value === "in-custody") {
        // Exclude both direct custody and active booking custody
        return Prisma.sql`${whereClause} AND jsonb_array_length(custody_agg.custody) = 0 AND NOT (
          ${ASSET_IS_CHECKED_OUT} AND EXISTS (
            SELECT 1 FROM "Booking" b
            JOIN "BookingAsset" atb ON b.id = atb."bookingId" AND a.id = atb."assetId"
            WHERE b.status IN ('ONGOING', 'OVERDUE')
          )
        )`;
      }
      if (filter.value === "without-custody") {
        // Include both direct custody and active booking custody
        return Prisma.sql`${whereClause} AND (
          jsonb_array_length(custody_agg.custody) > 0
          OR (${ASSET_IS_CHECKED_OUT} AND EXISTS (
            SELECT 1 FROM "Booking" b
            JOIN "BookingAsset" atb ON b.id = atb."bookingId" AND a.id = atb."assetId"
            WHERE b.status IN ('ONGOING', 'OVERDUE')
          ))
        )`;
      }
      return Prisma.sql`${whereClause} AND NOT (
        EXISTS (
          SELECT 1 FROM "Custody" cu
          WHERE cu."assetId" = a.id
          AND cu."teamMemberId" = ${filter.value}
        )
        OR (${ASSET_IS_CHECKED_OUT} AND EXISTS (
          SELECT 1 FROM "Booking" b
          JOIN "BookingAsset" atb ON b.id = atb."bookingId" AND a.id = atb."assetId"
          WHERE b.status IN ('ONGOING', 'OVERDUE')
          AND (
            b."custodianTeamMemberId" = ${filter.value}
            OR b."custodianUserId" = (
              SELECT "userId" FROM "TeamMember" tm WHERE tm.id = ${filter.value}
            )
          )
        ))
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
        // Only count booking custody when asset is still CHECKED_OUT
        return Prisma.sql`${whereClause} AND (
          jsonb_array_length(custody_agg.custody) > 0
          OR (${ASSET_IS_CHECKED_OUT} AND EXISTS (
            SELECT 1 FROM "Booking" b
            JOIN "BookingAsset" atb ON b.id = atb."bookingId" AND a.id = atb."assetId"
            WHERE b.status IN ('ONGOING', 'OVERDUE')
          ))
        )`;
      }

      // Handle "without-custody" - assets that don't have a custodian
      if (hasWithoutCustody) {
        const custodianIds = values.filter((v) => v !== "without-custody");

        if (custodianIds.length === 0) {
          return Prisma.sql`${whereClause} AND jsonb_array_length(custody_agg.custody) = 0 AND NOT (
            ${ASSET_IS_CHECKED_OUT} AND EXISTS (
              SELECT 1 FROM "Booking" b
              JOIN "BookingAsset" atb ON b.id = atb."bookingId" AND a.id = atb."assetId"
              WHERE b.status IN ('ONGOING', 'OVERDUE')
            )
          )`;
        }

        const custodianIdsArray = Prisma.join(
          custodianIds.map((id) => Prisma.sql`${id}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND (
          (jsonb_array_length(custody_agg.custody) = 0 AND NOT (
            ${ASSET_IS_CHECKED_OUT} AND EXISTS (
              SELECT 1 FROM "Booking" b
              JOIN "BookingAsset" atb ON b.id = atb."bookingId" AND a.id = atb."assetId"
              WHERE b.status IN ('ONGOING', 'OVERDUE')
            )
          ))
          OR EXISTS (
            SELECT 1 FROM "Custody" cu
            WHERE cu."assetId" = a.id
            AND cu."teamMemberId" = ANY(ARRAY[${custodianIdsArray}]::text[])
          )
          OR (${ASSET_IS_CHECKED_OUT} AND EXISTS (
            SELECT 1 FROM "Booking" b
            JOIN "BookingAsset" atb ON b.id = atb."bookingId" AND a.id = atb."assetId"
            WHERE b.status IN ('ONGOING', 'OVERDUE')
            AND (
              b."custodianTeamMemberId" = ANY(ARRAY[${custodianIdsArray}]::text[])
              OR b."custodianUserId" IN (
                SELECT "userId" FROM "TeamMember" tm
                WHERE tm.id = ANY(ARRAY[${custodianIdsArray}]::text[])
              )
            )
          ))
        )`;
      }

      // An empty custodian set matches no assets. Guard before
      // `Prisma.join([])` (which throws) — same crash class as SHELF-WEBAPP-1MY.
      if (values.length === 0) {
        return Prisma.sql`${whereClause} AND 1=0`;
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
        OR (${ASSET_IS_CHECKED_OUT} AND EXISTS (
          SELECT 1 FROM "Booking" b
          JOIN "BookingAsset" atb ON b.id = atb."bookingId" AND a.id = atb."assetId"
          WHERE b.status IN ('ONGOING', 'OVERDUE')
          AND (
            b."custodianTeamMemberId" = ANY(ARRAY[${custodianIdsArray}]::text[])
            OR b."custodianUserId" IN (
              SELECT "userId" FROM "TeamMember" tm
              WHERE tm.id = ANY(ARRAY[${custodianIdsArray}]::text[])
            )
          )
        ))
      )`;
    }

    default:
      return whereClause;
  }
}
/**
 * Adds upcoming bookings filtering to the WHERE clause
 * Handles "has-booking" and "without-booking" special values
 */
function addUpcomingBookingsFilter(
  whereClause: Prisma.Sql,
  filter: Filter
): Prisma.Sql {
  const bookingExistsSubquery = Prisma.sql`EXISTS (
    SELECT 1 FROM public."BookingAsset" atb
    JOIN public."Booking" bk ON atb."bookingId" = bk.id
    WHERE atb."assetId" = a.id
    AND bk.status IN ('RESERVED', 'ONGOING', 'OVERDUE')
  )`;

  switch (filter.operator) {
    case "is":
      if (filter.value === "has-booking") {
        return Prisma.sql`${whereClause} AND ${bookingExistsSubquery}`;
      }
      if (filter.value === "without-booking") {
        return Prisma.sql`${whereClause} AND NOT ${bookingExistsSubquery}`;
      }
      return Prisma.sql`${whereClause} AND EXISTS (
        SELECT 1 FROM public."BookingAsset" atb
        JOIN public."Booking" bk ON atb."bookingId" = bk.id
        WHERE atb."assetId" = a.id
        AND bk.id = ${filter.value}
        AND bk.status IN ('RESERVED', 'ONGOING', 'OVERDUE')
      )`;

    case "isNot":
      if (filter.value === "has-booking") {
        return Prisma.sql`${whereClause} AND NOT ${bookingExistsSubquery}`;
      }
      if (filter.value === "without-booking") {
        return Prisma.sql`${whereClause} AND ${bookingExistsSubquery}`;
      }
      return Prisma.sql`${whereClause} AND NOT EXISTS (
        SELECT 1 FROM public."BookingAsset" atb
        JOIN public."Booking" bk ON atb."bookingId" = bk.id
        WHERE atb."assetId" = a.id
        AND bk.id = ${filter.value}
        AND bk.status IN ('RESERVED', 'ONGOING', 'OVERDUE')
      )`;

    case "containsAny": {
      const values = (
        typeof filter.value === "string"
          ? filter.value.split(",").map((v) => v.trim())
          : Array.isArray(filter.value)
          ? filter.value
          : [filter.value]
      ).filter(Boolean);

      const hasBooking = values.includes("has-booking");
      const withoutBooking = values.includes("without-booking");

      // If both are selected, match all assets
      if (hasBooking && withoutBooking) {
        return whereClause;
      }

      // "has-booking" subsumes specific booking IDs - just check for any upcoming booking
      if (hasBooking) {
        return Prisma.sql`${whereClause} AND ${bookingExistsSubquery}`;
      }

      // Handle "without-booking" combined with specific booking IDs
      if (withoutBooking) {
        const bookingIds = values.filter((v) => v !== "without-booking");

        if (bookingIds.length === 0) {
          return Prisma.sql`${whereClause} AND NOT ${bookingExistsSubquery}`;
        }

        const bookingIdsArray = Prisma.join(
          bookingIds.map((id) => Prisma.sql`${id}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND (
          NOT ${bookingExistsSubquery}
          OR EXISTS (
            SELECT 1 FROM public."BookingAsset" atb
            JOIN public."Booking" bk ON atb."bookingId" = bk.id
            WHERE atb."assetId" = a.id
            AND bk.id = ANY(ARRAY[${bookingIdsArray}]::text[])
            AND bk.status IN ('RESERVED', 'ONGOING', 'OVERDUE')
          )
        )`;
      }

      // An empty booking set matches no assets. Guard before `Prisma.join([])`
      // (which throws) — same crash class as SHELF-WEBAPP-1MY.
      if (values.length === 0) {
        return Prisma.sql`${whereClause} AND 1=0`;
      }

      const bookingIdsArray = Prisma.join(
        values.map((id) => Prisma.sql`${id}`),
        ", "
      );
      return Prisma.sql`${whereClause} AND EXISTS (
        SELECT 1 FROM public."BookingAsset" atb
        JOIN public."Booking" bk ON atb."bookingId" = bk.id
        WHERE atb."assetId" = a.id
        AND bk.id = ANY(ARRAY[${bookingIdsArray}]::text[])
        AND bk.status IN ('RESERVED', 'ONGOING', 'OVERDUE')
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
          SELECT 1 FROM public."_AssetToTag" att
          WHERE att."A" = a.id
        )`;
      }
      // Single tag filtering via a per-asset EXISTS. Byte-identical to the
      // previous `t.id = value` against the fanning tag join (the join was an
      // inner semantic and GROUP BY deduped it) — but self-contained, so the
      // slim pagination phase needs no outer `t`/`att` join.
      return Prisma.sql`${whereClause} AND EXISTS (
        SELECT 1 FROM public."_AssetToTag" att
        JOIN public."Tag" t ON att."B" = t.id
        WHERE att."A" = a.id AND t.id = ${filter.value}
      )`;
    }
    case "containsAll": {
      // ALL tags must be present
      const values = (filter.value as string).split(",").map((v) => v.trim());

      // If "untagged" is included, return assets with no tags
      // (an asset can't be both untagged and have tags)
      if (values.includes("untagged")) {
        return Prisma.sql`${whereClause} AND NOT EXISTS (
          SELECT 1 FROM public."_AssetToTag" att
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
        FROM public."_AssetToTag" att
        JOIN public."Tag" t ON t.id = att."B"
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
            SELECT 1 FROM public."_AssetToTag" att
            WHERE att."A" = a.id
          )`;
        }

        // Return assets that are either untagged OR have one of the specified tags
        const valuesArray = Prisma.join(
          tagIds.map((id) => Prisma.sql`${id}`),
          ", "
        );
        return Prisma.sql`${whereClause} AND (
          NOT EXISTS (SELECT 1 FROM public."_AssetToTag" att WHERE att."A" = a.id)
          OR EXISTS (
            SELECT 1 FROM public."_AssetToTag" att
            JOIN public."Tag" t ON att."B" = t.id
            WHERE att."A" = a.id AND t.id = ANY(ARRAY[${valuesArray}]::text[])
          )
        )`;
      }

      const valuesArray = Prisma.join(
        values.map((v) => Prisma.sql`${v}`),
        ", "
      );
      // Any-tag EXISTS (see the `contains` branch) — keeps the slim phase free
      // of the fanning tag join while preserving match semantics.
      return Prisma.sql`${whereClause} AND EXISTS (
        SELECT 1 FROM public."_AssetToTag" att
        JOIN public."Tag" t ON att."B" = t.id
        WHERE att."A" = a.id AND t.id = ANY(ARRAY[${valuesArray}]::text[])
      )`;
    }

    case "excludeAny": {
      // Exclude assets that have ANY of the specified tags
      const values = (filter.value as string).split(",").map((v) => v.trim());

      if (values.includes("untagged")) {
        // If "untagged" is included, we want to ensure assets have at least one tag
        return Prisma.sql`${whereClause} AND EXISTS (
          SELECT 1 FROM public."_AssetToTag" att2
          WHERE att2."A" = a.id
        )`;
      }

      const valuesArray = Prisma.join(
        values.map((v) => Prisma.sql`${v}`),
        ", "
      );
      return Prisma.sql`${whereClause} AND NOT EXISTS (
        SELECT 1
        FROM public."_AssetToTag" att2
        JOIN public."Tag" t2 ON t2.id = att2."B"
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
  | "availableToBook"
  | "type"
  | "quantity";

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
  type: "assetType",
  quantity: "assetQuantity",
};

/**
 * Generates a PostgreSQL expression for natural sorting of text values
 * Handles case-insensitive comparison and natural number ordering.
 * What is natural sorting? https://en.wikipedia.org/wiki/Natural_sort_order
 * - Ignore case (treat uppercase and lowercase the same)
 * - Sort numbers as whole values rather than character-by-character
 * - Place purely alphabetic entries before alphanumeric ones
 *
 * SECURITY: `columnRef` and `direction` are interpolated into raw SQL.
 * Callers MUST pass either a hardcoded literal or a value validated against
 * `SAFE_SQL_IDENTIFIER` (and an allowlisted direction). Never pass raw user
 * input here.
 *
 * @param columnRef - The column or expression to sort. Caller-validated.
 * @param direction - Sort direction ('asc' or 'desc'). Caller-validated.
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
 * Generates a PostgreSQL expression for sorting sequential asset IDs
 * (e.g. "SAM-1", "SAM-2", "SAM-10") in numeric order.
 *
 * SECURITY: `columnRef` and `direction` are interpolated into raw SQL.
 * Same caller contract as {@link getNormalizedSortExpression}.
 *
 * @param columnRef - The column or expression to sort. Caller-validated.
 * @param direction - Sort direction ('asc' or 'desc'). Caller-validated.
 * @returns SQL string with sequential-ID sorting expression
 */
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
 * Allowlist of permitted sort directions.
 *
 * The user-supplied direction is normalized to lowercase and compared against
 * this set before being interpolated into raw SQL. Anything outside this set
 * defaults to "asc" — never reaches the database verbatim.
 */
const VALID_DIRECTIONS = new Set<"asc" | "desc">(["asc", "desc"]);

/**
 * Normalizes a user-supplied sort direction to "asc" or "desc".
 *
 * Behavior:
 * - Missing or empty direction → defaults to "asc" (legacy URL pattern:
 *   `?sortBy=name`).
 * - Recognized direction (any case) → normalized to lowercase.
 * - Anything else → throws `ShelfError` (HTTP 400). Surfacing the bad
 *   input is preferred over silently sorting ascending, both for UX
 *   clarity and because invalid direction is the primary signal that
 *   someone is poking at the sort param.
 *
 * @param raw - The raw direction string from the URL.
 * @returns A safe lowercase direction.
 * @throws {ShelfError} When `raw` is non-empty and not a recognized direction.
 */
function normalizeDirection(raw: string | undefined): "asc" | "desc" {
  if (raw === undefined || raw === "") return "asc";
  const lowered = raw.toLowerCase();
  if (VALID_DIRECTIONS.has(lowered as "asc" | "desc")) {
    return lowered as "asc" | "desc";
  }
  throw new ShelfError({
    cause: null,
    message: `Invalid sort direction: "${raw}". Must be "asc" or "desc".`,
    title: "Invalid sort direction",
    additionalData: { direction: raw },
    label: "Assets",
    status: 400,
    shouldBeCaptured: false,
  });
}

/**
 * Enhanced sorting options parser with natural sort support.
 * Handles case-insensitive sorting with natural number ordering.
 *
 * SECURITY: builds a raw SQL `ORDER BY` clause that is later passed to
 * `Prisma.raw(...)` inside `getAdvancedPaginatedAndFilterableAssets`. Every
 * value interpolated into the clause must be either a hardcoded literal or
 * validated against {@link isSafeSqlIdentifier}. Direction is normalized via
 * {@link normalizeDirection}. Field names that don't match a known branch
 * (or whose dynamic suffix fails identifier validation) are dropped with a
 * warning — the caller falls back to the default sort. See GHSA-69xv-wmgg-3qp3.
 *
 * @param sortBy - Array of sort specifications in format: field:direction[:fieldType]
 * @returns Object containing the full SQL `ORDER BY` clause, the same clause
 *   without the leading `ORDER BY ` token (`orderByInner`, for embedding in a
 *   `ROW_NUMBER() OVER (ORDER BY ...)` window), and custom field sorting info.
 */
export function parseSortingOptions(sortBy: string[]): {
  orderByClause: string;
  orderByInner: string;
  customFieldSortings: CustomFieldSorting[];
} {
  const fields = sortBy.map((s) => {
    const [name, direction, fieldType] = s.split(":");
    return {
      name: name ?? "",
      direction: normalizeDirection(direction),
      fieldType: fieldType as CustomFieldType,
    };
  });

  const orderByParts: string[] = [];
  const customFieldSortings: CustomFieldSorting[] = [];

  for (const field of fields) {
    // Use Object.hasOwn to avoid prototype-chain matches like "toString" or
    // "constructor", which would otherwise resolve via Object.prototype and
    // produce broken SQL. Bypassing the unknown-field fallback this way is not
    // exploitable but creates a DoS / 500 path — keep the allowlist strict.
    if (Object.hasOwn(directAssetFields, field.name)) {
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
      } else if (field.name === "valuation") {
        // Quantity-aware: sort by TOTAL value (per-unit × quantity), matching
        // what the "Value" cell displays. INDIVIDUAL assets are quantity=1 so
        // this is identical to sorting on `assetValue` for them; QT assets
        // are now ordered by total worth (the number users actually compare),
        // not per-unit price. `assetValue` and `assetQuantity` are aliases on
        // the outer SELECT — safe to multiply without quoting concerns.
        orderByParts.push(
          `("assetValue" * "assetQuantity") ${field.direction}`
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
    } else if (field.name === "assetModel") {
      orderByParts.push(
        getNormalizedSortExpression(`"assetModelName"`, field.direction)
      );
    } else if (field.name === "location") {
      orderByParts.push(
        getNormalizedSortExpression(`"locationName"`, field.direction)
      );
    } else if (field.name === "custody") {
      // `custody` is a jsonb ARRAY (`Custody[]`) since the quantity-tracked
      // multi-custodian refactor — see CUSTODY_SORT_CASE. `custody->>'name'`
      // (object-key access) returns NULL on an array, which made this sort a
      // silent no-op (asc == desc, only the id tiebreaker ordered the rows).
      // Index the first custodian: `custody->0->>'name'`. Element 0 is the
      // primary custodian shown in the badge (formatCustodyList picks
      // custody[0]); the custody aggregations order their jsonb_agg by
      // (createdAt, id) so element 0 is deterministic and the sort key agrees
      // with the rendered badge. NULL custody (no custodian) stays NULL and
      // sorts consistently.
      orderByParts.push(
        getNormalizedSortExpression(`custody->0->>'name'`, field.direction)
      );
    } else if (field.name.startsWith("barcode_")) {
      // The suffix is interpolated into a SQL identifier (`barcode_<suffix>`),
      // so it must contain only safe identifier characters. Anything else is
      // dropped — see GHSA-69xv-wmgg-3qp3.
      const barcodeType = field.name.slice("barcode_".length);
      if (!isSafeSqlIdentifier(barcodeType)) {
        Logger.warn(
          new ShelfError({
            cause: null,
            message: "Skipping sort term: unsafe barcode field name",
            additionalData: { fieldName: field.name },
            label: "Assets",
            shouldBeCaptured: false,
          })
        );
        continue;
      }
      orderByParts.push(
        getNormalizedSortExpression(`barcode_${barcodeType}`, field.direction)
      );
    } else if (field.name.startsWith("cf_")) {
      const customFieldName = field.name.slice(3);
      const alias = `cf_${customFieldName.replace(/\s+/g, "_")}`;
      // The alias is interpolated into raw SQL both here (ORDER BY) and in
      // generateCustomFieldSelect (SELECT ... AS <alias>). Reject any alias
      // that isn't a safe identifier.
      if (!isSafeSqlIdentifier(alias)) {
        Logger.warn(
          new ShelfError({
            cause: null,
            message: "Skipping sort term: unsafe custom field name",
            additionalData: { fieldName: field.name, alias },
            label: "Assets",
            shouldBeCaptured: false,
          })
        );
        continue;
      }
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
      Logger.warn(
        new ShelfError({
          cause: null,
          message: "Skipping sort term: unknown field",
          additionalData: { fieldName: field.name },
          label: "Assets",
          shouldBeCaptured: false,
        })
      );
    }
  }
  if (orderByParts.length === 0) {
    // Default sort: Most recent assets first, with stable secondary sort by ID
    // This provides a logical default while ensuring deterministic results
    orderByParts.push(
      '"assetCreatedAt" DESC', // Primary: Newest assets first
      '"assetId" ASC' // Secondary: Stable sort for identical timestamps
    );
  } else if (!orderByParts.some((part) => part.includes('"assetId"'))) {
    // Explicit sorts have no unique tiebreaker of their own, so rows tied on the
    // sort key (e.g. same category name, same total value, or a mostly-NULL
    // column) land in an arbitrary physical order that can shift between page
    // loads — a latent nondeterministic-pagination bug. Append a stable id
    // tiebreaker (mirrors the default sort's secondary key) so the paged slice
    // and the integer ROW_NUMBER rank are reproducible across requests.
    //
    // Skip it when the client already sorts by id (directAssetFields.id maps to
    // "assetId"), otherwise we'd emit a duplicate ORDER BY key.
    orderByParts.push('"assetId" ASC');
  }

  // The inner clause (no leading "ORDER BY ") is what feeds the integer-rank
  // window in the paginate-first rewrite: ROW_NUMBER() OVER (ORDER BY <inner>).
  const orderByInner: string = orderByParts.join(", ");
  // Always generate an ORDER BY clause for predictable results
  const orderByClause: string = `ORDER BY ${orderByInner}`;

  return { orderByClause, orderByInner, customFieldSortings };
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

/**
 * Builds the SELECT-side custom-field subqueries that match the aliases
 * produced by {@link parseSortingOptions}.
 *
 * SECURITY: each alias is interpolated as a raw SQL identifier
 * (`AS ${Prisma.raw(cf.alias)}`). This is a defense-in-depth guard: the
 * parser already validates aliases via {@link isSafeSqlIdentifier}, so this
 * check should never throw in practice. It exists to keep the function
 * safe under future refactors or alternate callers.
 *
 * @throws {ShelfError} If any alias fails identifier validation.
 */
export function generateCustomFieldSelect(
  customFieldSortings: CustomFieldSorting[]
): Prisma.Sql {
  if (customFieldSortings.length === 0) return Prisma.empty;

  for (const cf of customFieldSortings) {
    if (!isSafeSqlIdentifier(cf.alias)) {
      throw new ShelfError({
        cause: null,
        message: "Invalid custom field alias for SQL select",
        additionalData: { alias: cf.alias },
        label: "Assets",
      });
    }
  }

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
  /**
   * When true (default), includes full custom field definitions (helpText,
   * required, options, categories) in each custom field value — matching
   * the AdvancedIndexAsset type contract. Set to false for table views
   * that only need id, name, and type, avoiding the expensive categories
   * subquery per field per asset.
   */
  withCustomFieldDefinitions?: boolean;
};

export type AssetReturnOptions = {
  withBookings?: boolean;
  withBarcodes?: boolean;
  /**
   * When provided, the emitted `json_agg` orders its elements by this SQL
   * expression: `json_agg(jsonb_build_object(...) ORDER BY <orderBy>)`. The
   * paginate-first rewrite passes the integer sort rank (`saq."__sortRank"`)
   * so the output array matches the paginated `ORDER BY` order exactly, without
   * re-evaluating the (possibly tiebreaker-less) sort expressions. Omit it and
   * the array order is unspecified (legacy single-CTE behavior).
   */
  orderBy?: Prisma.Sql;
};

// Convert to functions that accept options
export const assetQueryFragment = (options: AssetQueryOptions = {}) => {
  const {
    withBookings = false,
    withBarcodes = false,
    withCustomFieldDefinitions = true,
  } = options;

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
            END,
            'assetKitId', atb."assetKitId",
            'quantity', atb."quantity",
            'kitName', bk_kit.name
          )
        ),
        '[]'::jsonb
      )
      FROM public."BookingAsset" atb
      JOIN public."Booking" bk ON atb."bookingId" = bk.id
      LEFT JOIN public."TeamMember" ctm ON bk."custodianTeamMemberId" = ctm.id
      LEFT JOIN public."User" ctmu ON ctm."userId" = ctmu.id
      LEFT JOIN public."User" cu ON bk."custodianUserId" = cu.id
      LEFT JOIN public."User" cr ON bk."creatorId" = cr.id
      -- Booking-slice kit attribution. Org-scoped (bk_ak."organizationId" =
      -- a."organizationId") so a tampered / cross-org assetKitId resolves to
      -- NULL instead of leaking another workspace's kit name — mirrors the
      -- simple-mode helper. Distinct aliases (bk_ak/bk_kit) so this correlated
      -- subquery does not shadow the outer query's ak/k (the asset's own kit).
      LEFT JOIN public."AssetKit" bk_ak
        ON atb."assetKitId" = bk_ak.id
        AND bk_ak."organizationId" = a."organizationId"
      LEFT JOIN public."Kit" bk_kit ON bk_ak."kitId" = bk_kit.id
      WHERE
        atb."assetId" = a.id
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
      ORDER BY b."createdAt" ASC, b.id ASC
      LIMIT 1
    ) AS barcode_Code128,
    (
      SELECT b.value
      FROM public."Barcode" b
      WHERE b."assetId" = a.id AND b.type = 'Code39'
      ORDER BY b."createdAt" ASC, b.id ASC
      LIMIT 1
    ) AS barcode_Code39,
    (
      SELECT b.value
      FROM public."Barcode" b
      WHERE b."assetId" = a.id AND b.type = 'DataMatrix'
      ORDER BY b."createdAt" ASC, b.id ASC
      LIMIT 1
    ) AS barcode_DataMatrix,
    (
      SELECT b.value
      FROM public."Barcode" b
      WHERE b."assetId" = a.id AND b.type = 'ExternalQR'
      ORDER BY b."createdAt" ASC, b.id ASC
      LIMIT 1
    ) AS barcode_ExternalQR,
    (
      SELECT b.value
      FROM public."Barcode" b
      WHERE b."assetId" = a.id AND b.type = 'EAN13'
      ORDER BY b."createdAt" ASC, b.id ASC
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
        ORDER BY q."createdAt" ASC, q.id ASC
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
      l.id AS "assetLocationId",
      a."organizationId" AS "assetOrganizationId",
      a.status AS "assetStatus",
      a.type AS "assetType",
      a.value AS "assetValue",
      a.quantity AS "assetQuantity",
      a."unitOfMeasure" AS "assetUnitOfMeasure",
      a."availableToBook" AS "assetAvailableToBook",
      k.id AS "assetKitId",
      a."categoryId" AS "assetCategoryId",
      a."assetModelId" AS "assetModelId",
      am.name AS "assetModelName",
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
      kits_agg.kits AS kits,
      locations_agg.locations AS locations,
      COALESCE(
        jsonb_agg(
          DISTINCT jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
        ) FILTER (WHERE t.id IS NOT NULL),
        '[]'::jsonb
      ) AS tags,
      CASE
        -- Direct custody (via Custody table) — aggregated by lateral
        -- subquery so a multi-custodian qty-tracked asset returns one
        -- row with the full list, not N rows. Always wins over the
        -- booking-derived fallback when the asset has any direct
        -- custody rows. Replaces main's COALESCE+CASE direct-custody
        -- path: the LATERAL custody_agg join covers the 1:many widening
        -- that Phase 2 introduced.
        WHEN jsonb_array_length(custody_agg.custody) > 0 THEN custody_agg.custody
        -- Booking-derived synthetic custody for CHECKED_OUT assets that
        -- have no direct Custody row but are part of an active booking.
        -- Wrapped in jsonb_build_array() so the output shape matches
        -- the Custody[] schema consistently — same as custody_agg above.
        -- The inner jsonb_build_object below carries main's NRM-name
        -- CASE guard fix (commit 37d40781e), which auto-merged into
        -- this branch via the post-conflict region.
        WHEN b.id IS NOT NULL AND ${ASSET_IS_CHECKED_OUT} THEN
          jsonb_build_array(
            jsonb_build_object(
              -- why: when the booking custodian is an NRM (team member with no
              -- user account), bu.* is NULL. We must NOT CONCAT the user columns
              -- here: Postgres CONCAT ignores NULLs and returns ' ' (a space),
              -- which is non-NULL, so a COALESCE(CONCAT(...), btm.name) would
              -- never fall back to the NRM name and the badge renders blank.
              -- Guard on bu.id (mirrors the 'user' sub-object branch below).
              'name', CASE
                WHEN bu.id IS NOT NULL
                  THEN CONCAT(bu."firstName", ' ', bu."lastName")
                ELSE btm.name
              END,
              'custodian', jsonb_build_object(
                'name', CASE
                  WHEN bu.id IS NOT NULL
                    THEN CONCAT(bu."firstName", ' ', bu."lastName")
                  ELSE btm.name
                END,
                'user', CASE
                  WHEN bu.id IS NOT NULL THEN
                    jsonb_build_object(
                      'id', bu.id,
                      'firstName', bu."firstName",
                      'lastName', bu."lastName",
                      'profilePicture', bu."profilePicture",
                      'email', bu.email
                    )
                  ELSE NULL
                END
              )
            )
          )
        ELSE NULL
      END AS custody,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', acfv.id,
            'value', acfv.value,
            'customField', ${
              withCustomFieldDefinitions
                ? Prisma.sql`jsonb_build_object(
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
            )`
                : Prisma.sql`jsonb_build_object(
              'id', cf.id,
              'name', cf.name,
              'type', cf.type
            )`
            }
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
  -- Kit membership goes through the AssetKit pivot. AssetKit has no
  -- @@unique([assetId]) (qty-tracked assets can belong to multiple
  -- kits), so a plain LEFT JOIN AssetKit would fan out and duplicate
  -- the asset in the index. Use a LATERAL primary-pick (oldest pivot
  -- row) to keep exactly one kit row per asset — used for ORDER BY
  -- (by primary kit name) and for the singular kit field on the row
  -- projection.
  LEFT JOIN LATERAL (
    SELECT k.id, k.name, k.status
    FROM public."AssetKit" ak
    JOIN public."Kit" k ON ak."kitId" = k.id
    WHERE ak."assetId" = a.id
    ORDER BY ak."createdAt" ASC, ak.id ASC
    LIMIT 1
  ) k ON TRUE
  -- Full kit membership aggregated as a jsonb array, so the asset-index
  -- "Kit" column can render primary + "+N more" for multi-kit qty-
  -- tracked assets (mirror of custody_agg below). Always returns an
  -- array (COALESCE → '[]'::jsonb) so the column code never branches
  -- on null.
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object('id', k2.id, 'name', k2.name, 'status', k2.status)
        ORDER BY ak2."createdAt" ASC, ak2.id ASC
      ),
      '[]'::jsonb
    ) AS kits
    FROM public."AssetKit" ak2
    JOIN public."Kit" k2 ON ak2."kitId" = k2.id
    WHERE ak2."assetId" = a.id
  ) kits_agg ON TRUE
  LEFT JOIN public."Category" c ON a."categoryId" = c.id
  LEFT JOIN public."AssetModel" am ON a."assetModelId" = am.id
  -- Placement goes through the AssetLocation pivot. Same fan-out concern
  -- as kit (qty-tracked can be at many locations) — LATERAL primary-pick
  -- yields one "primary location" per asset.
  LEFT JOIN LATERAL (
    SELECT l.id, l.name, l."parentId"
    FROM public."AssetLocation" al
    JOIN public."Location" l ON al."locationId" = l.id
    WHERE al."assetId" = a.id
    ORDER BY al."createdAt" ASC, al.id ASC
    LIMIT 1
  ) l ON TRUE
  -- Full placement list aggregated as a jsonb array, mirror of
  -- kits_agg above. Drives the asset-index "Location" column's
  -- primary + "+N more" rendering for qty-tracked assets placed at
  -- multiple locations.
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', l2.id,
          'name', l2.name,
          'parentId', l2."parentId",
          'childCount', (
            SELECT COUNT(*)::integer
            FROM public."Location" lc2
            WHERE lc2."parentId" = l2.id
          )
        )
        ORDER BY al2."createdAt" ASC, al2.id ASC
      ),
      '[]'::jsonb
    ) AS locations
    FROM public."AssetLocation" al2
    JOIN public."Location" l2 ON al2."locationId" = l2.id
    WHERE al2."assetId" = a.id
  ) locations_agg ON TRUE
  LEFT JOIN public."_AssetToTag" att ON a.id = att."A"
  LEFT JOIN public."Tag" t ON att."B" = t.id
  LEFT JOIN LATERAL (
    -- Aggregate ALL custody rows for this asset into a single jsonb
    -- array. Replaces the previous direct LEFT JOINs on Custody +
    -- TeamMember + User which caused per-custody-row duplication for
    -- qty-tracked assets with multiple custodians (Issue A).
    --
    -- The ORDER BY inside jsonb_agg is load-bearing, not cosmetic:
    -- element 0 is the "primary" custodian both for display
    -- (formatCustodyList picks custody[0]) and for sorting (the custody
    -- ORDER BY key indexes custody->0->>'name'). jsonb_agg without an
    -- explicit ORDER BY has an undefined input order, so the primary
    -- could differ between rows/plans and the sort key could disagree
    -- with the rendered badge. Order by oldest custody first
    -- (createdAt, id) — the same primary-pick convention the kit /
    -- location LATERALs use. Must stay identical to CHEAP_CUSTODY_JOINS.
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'name', tm.name,
          'quantity', cu.quantity,
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
        ORDER BY cu."createdAt" ASC, cu.id ASC
      ),
      '[]'::jsonb
    ) AS custody
    FROM public."Custody" cu
    LEFT JOIN public."TeamMember" tm ON cu."teamMemberId" = tm.id
    LEFT JOIN public."User" u ON tm."userId" = u.id
    WHERE cu."assetId" = a.id
  ) custody_agg ON TRUE
  LEFT JOIN LATERAL (
    SELECT b.*
    FROM public."Booking" b
    JOIN public."BookingAsset" atb ON b.id = atb."bookingId" AND a.id = atb."assetId"
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
  const { withBookings = false, withBarcodes = false, orderBy } = options;

  const bookingsField = withBookings
    ? Prisma.sql`,
        'bookings', COALESCE(aq.bookings, '[]'::jsonb)`
    : Prisma.sql``;

  const barcodesField = withBarcodes
    ? Prisma.sql`,
        'barcodes', COALESCE(aq.barcodes, '[]'::jsonb)`
    : Prisma.sql``;

  // Optional deterministic array ordering. `json_agg(... ORDER BY <expr>)`
  // sorts the aggregated elements; without it the array order is whatever the
  // input relation yields. The rewrite passes the integer sort rank here.
  const aggOrderBy = orderBy ? Prisma.sql` ORDER BY ${orderBy}` : Prisma.empty;

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
          'assetModelId', aq."assetModelId",
          'assetModelName', aq."assetModelName",
          'organizationId', aq."assetOrganizationId",
          'status', aq."assetStatus",
          'type', aq."assetType",
          'valuation', aq."assetValue",
          'quantity', aq."assetQuantity",
          'unitOfMeasure', aq."assetUnitOfMeasure",
          'availableToBook', aq."assetAvailableToBook",
          'kitId', aq."assetKitId",
          'kit', CASE WHEN aq."kitId" IS NOT NULL THEN jsonb_build_object('id', aq."kitId", 'name', aq."kitName", 'status', aq."kitStatus") ELSE NULL END,
          'kits', COALESCE(aq.kits, '[]'::jsonb),
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
          'locations', COALESCE(aq.locations, '[]'::jsonb),
          'custody', aq.custody,
          'customFields', COALESCE(aq."customFields", '[]'::jsonb),
          'upcomingReminder', aq.upcomingReminder${bookingsField}${barcodesField}
        )${aggOrderBy}
      ) FILTER (WHERE aq."assetId" IS NOT NULL),
      '[]'
    ) AS assets
  `;
};

/**
 * Sort-key building blocks for the slim (cheap) pagination phase.
 *
 * The paginate-first rewrite splits the advanced index into a cheap phase
 * (id + sort keys only, no GROUP BY, one row per matching asset) and a heavy
 * phase (the full projection, run once per page row via LEFT JOIN LATERAL).
 * The heavy phase keeps its own inline copies of these expressions inside
 * {@link assetQueryFragment} / {@link assetQueryJoins} — because ordering is
 * frozen into an integer rank in the cheap phase, the two phases do NOT need
 * to be byte-identical, so duplicating the SQL here is safe and keeps the
 * heavy fragments untouched.
 *
 * @see {@link buildAdvancedAssetsQuery}
 */

/**
 * qrId scalar subquery — the first QR id linked to the asset. Used as a sort
 * key (`ORDER BY "qrId"`) only when a qrId sort is active.
 */
const QR_ID_SUBQUERY = Prisma.sql`(
        SELECT q.id
        FROM public."Qr" q
        WHERE q."assetId" = a.id
        ORDER BY q."createdAt" ASC, q.id ASC
        LIMIT 1
      )`;

/**
 * The five per-type barcode scalar subqueries, aliased as the identifiers the
 * `barcode_<Type>` sort terms reference. Injected into the cheap phase only
 * when a barcode sort is active. Never part of the output (sort-only).
 */
const BARCODE_SORT_KEY_SELECTS = Prisma.sql`(
        SELECT b.value FROM public."Barcode" b
        WHERE b."assetId" = a.id AND b.type = 'Code128' ORDER BY b."createdAt" ASC, b.id ASC LIMIT 1
      ) AS barcode_Code128,
      (
        SELECT b.value FROM public."Barcode" b
        WHERE b."assetId" = a.id AND b.type = 'Code39' ORDER BY b."createdAt" ASC, b.id ASC LIMIT 1
      ) AS barcode_Code39,
      (
        SELECT b.value FROM public."Barcode" b
        WHERE b."assetId" = a.id AND b.type = 'DataMatrix' ORDER BY b."createdAt" ASC, b.id ASC LIMIT 1
      ) AS barcode_DataMatrix,
      (
        SELECT b.value FROM public."Barcode" b
        WHERE b."assetId" = a.id AND b.type = 'ExternalQR' ORDER BY b."createdAt" ASC, b.id ASC LIMIT 1
      ) AS barcode_ExternalQR,
      (
        SELECT b.value FROM public."Barcode" b
        WHERE b."assetId" = a.id AND b.type = 'EAN13' ORDER BY b."createdAt" ASC, b.id ASC LIMIT 1
      ) AS barcode_EAN13`;

/**
 * The custody CASE expression (direct custody wins; booking-derived synthetic
 * custody for CHECKED_OUT assets otherwise; NULL). Verbatim copy of the heavy
 * projection's custody CASE, including the NRM-name guard (CONCAT vs btm.name,
 * never COALESCE(CONCAT(...))). Emitted `AS custody` in the cheap phase only
 * when a custody sort is active — the `custody->0->>'name'` sort term needs it.
 */
const CUSTODY_SORT_CASE = Prisma.sql`CASE
        WHEN jsonb_array_length(custody_agg.custody) > 0 THEN custody_agg.custody
        WHEN b.id IS NOT NULL AND ${ASSET_IS_CHECKED_OUT} THEN
          jsonb_build_array(
            jsonb_build_object(
              'name', CASE
                WHEN bu.id IS NOT NULL
                  THEN CONCAT(bu."firstName", ' ', bu."lastName")
                ELSE btm.name
              END,
              'custodian', jsonb_build_object(
                'name', CASE
                  WHEN bu.id IS NOT NULL
                    THEN CONCAT(bu."firstName", ' ', bu."lastName")
                  ELSE btm.name
                END,
                'user', CASE
                  WHEN bu.id IS NOT NULL THEN
                    jsonb_build_object(
                      'id', bu.id,
                      'firstName', bu."firstName",
                      'lastName', bu."lastName",
                      'profilePicture', bu."profilePicture",
                      'email', bu.email
                    )
                  ELSE NULL
                END
              )
            )
          )
        ELSE NULL
      END`;

/**
 * Cheap-phase base joins, split per alias so the slim CTE only pays for the
 * joins a given request actually needs. Each is a 1:1 join or LATERAL
 * primary-pick (no fan-out), a verbatim mirror of the corresponding join in
 * {@link assetQueryJoins}. Gated in {@link buildAdvancedAssetsQuery} on whether
 * the active sort references the joined name (kit/category/assetModel/location)
 * and — for category/location — whether a text search is active (the search
 * predicate references `c.name` / `l.name`). why: joining all four for every
 * matching asset even under the default `createdAt` sort was the residual O(N)
 * cost that kept the rewrite ~2× instead of ~10× faster.
 */
const CHEAP_KIT_JOIN = Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT k.id, k.name, k.status
      FROM public."AssetKit" ak
      JOIN public."Kit" k ON ak."kitId" = k.id
      WHERE ak."assetId" = a.id
      ORDER BY ak."createdAt" ASC, ak.id ASC
      LIMIT 1
    ) k ON TRUE`;
const CHEAP_CATEGORY_JOIN = Prisma.sql`
    LEFT JOIN public."Category" c ON a."categoryId" = c.id`;
const CHEAP_ASSET_MODEL_JOIN = Prisma.sql`
    LEFT JOIN public."AssetModel" am ON a."assetModelId" = am.id`;
const CHEAP_LOCATION_JOIN = Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT l.id, l.name, l."parentId"
      FROM public."AssetLocation" al
      JOIN public."Location" l ON al."locationId" = l.id
      WHERE al."assetId" = a.id
      ORDER BY al."createdAt" ASC, al.id ASC
      LIMIT 1
    ) l ON TRUE`;

/**
 * Cheap-phase custody joins: the per-asset custody aggregation (`custody_agg`)
 * plus the active-booking LATERAL (`b`) and its custodian joins (`bu`/`btm`).
 * Injected only when a custody FILTER or a custody SORT is active — the custody
 * WHERE predicates reference `jsonb_array_length(custody_agg.custody)` and the
 * custody sort key references the full CASE (which needs `b`/`bu`/`btm`).
 * Verbatim mirror of the custody joins in {@link assetQueryJoins} — including
 * the `ORDER BY cu."createdAt" ASC, cu.id ASC` inside `jsonb_agg` that makes
 * element 0 (the primary custodian used by the sort key `custody->0->>'name'`)
 * deterministic and consistent with the heavy phase's rendered badge.
 */
const CHEAP_CUSTODY_JOINS = Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'name', tm.name,
            'quantity', cu.quantity,
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
          ORDER BY cu."createdAt" ASC, cu.id ASC
        ),
        '[]'::jsonb
      ) AS custody
      FROM public."Custody" cu
      LEFT JOIN public."TeamMember" tm ON cu."teamMemberId" = tm.id
      LEFT JOIN public."User" u ON tm."userId" = u.id
      WHERE cu."assetId" = a.id
    ) custody_agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT b.*
      FROM public."Booking" b
      JOIN public."BookingAsset" atb ON b.id = atb."bookingId" AND a.id = atb."assetId"
      WHERE b.status IN ('ONGOING', 'OVERDUE')
      LIMIT 1
    ) b ON TRUE
    LEFT JOIN public."User" bu ON b."custodianUserId" = bu.id
    LEFT JOIN public."TeamMember" btm ON b."custodianTeamMemberId" = btm.id
`;

/**
 * Detects which sort-only subquery selects the cheap phase must emit so that
 * every alias the `ORDER BY` references also exists in the slim SELECT. Missing
 * an active sort's alias is a `column does not exist` 500, so over-inclusion is
 * the safe direction (an unused select never breaks the query).
 *
 * @param sortBy - Raw `sortBy` specs (`field:direction[:fieldType]`).
 * @returns Flags for the qrId, custody, and barcode sort-key families.
 */
function detectActiveSortKeys(sortBy: string[]): {
  qrId: boolean;
  custody: boolean;
  barcode: boolean;
  kitName: boolean;
  categoryName: boolean;
  assetModelName: boolean;
  locationName: boolean;
} {
  let qrId = false;
  let custody = false;
  let barcode = false;
  let kitName = false;
  let categoryName = false;
  let assetModelName = false;
  let locationName = false;
  for (const spec of sortBy) {
    const name = spec.split(":")[0] ?? "";
    if (name === "qrId") qrId = true;
    else if (name === "custody") custody = true;
    else if (name.startsWith("barcode_")) barcode = true;
    // Joined-name sort keys (mirror the parseSortingOptions field-name branches):
    // "kit" -> kitName, "category" -> categoryName, etc.
    else if (name === "kit") kitName = true;
    else if (name === "category") categoryName = true;
    else if (name === "assetModel") assetModelName = true;
    else if (name === "location") locationName = true;
  }
  return {
    qrId,
    custody,
    barcode,
    kitName,
    categoryName,
    assetModelName,
    locationName,
  };
}

/** Parameters for {@link buildAdvancedAssetsQuery}. */
export type BuildAdvancedAssetsQueryParams = {
  /** WHERE clause from {@link generateWhereClause} (org scope + filters). */
  whereClause: Prisma.Sql;
  /** Inner `ORDER BY` body (no leading `ORDER BY `) from {@link parseSortingOptions}. */
  orderByInner: string;
  /** Validated custom-field sortings from {@link parseSortingOptions}. */
  customFieldSortings: CustomFieldSorting[];
  /** Raw `sortBy` specs, used to detect active qrId/custody/barcode sort keys. */
  sortBy: string[];
  /** Parsed filters, used to detect whether a custody filter is active. */
  parsedFilters: Filter[];
  /** Include the bookings jsonb aggregation (availability calendar / column). */
  withBookings: boolean;
  /** Include the barcodes jsonb aggregation. */
  withBarcodes: boolean;
  /** `LIMIT/OFFSET` fragment, or `Prisma.empty` for takeAll (full export). */
  paginationClause: Prisma.Sql;
  /**
   * Whether a free-text search is active. The search predicate references
   * `c.name` / `l.name`, so the cheap phase must join Category + Location even
   * when no category/location sort is active.
   */
  hasSearch: boolean;
};

/**
 * Assembles the advanced asset-index query using the paginate-first design.
 *
 * Shape (three CTEs + a lateral heavy phase):
 * 1. `asset_query` — SLIM: `a.id` + sort keys only, one row per matching asset,
 *    NO `GROUP BY` (the tag search/filter is EXISTS-ified in
 *    {@link generateWhereClause}, so no fanning tag join remains).
 * 2. `sorted_asset_query` — `ROW_NUMBER()` freezes the sort into an integer
 *    `__sortRank`, then `LIMIT/OFFSET` slices the page.
 * 3. `count_query` — `COUNT(*)` over the slim set (full filtered total).
 * The final SELECT runs the ENTIRE heavy projection once per page row via
 * `LEFT JOIN LATERAL`, and `json_agg` orders by the integer `__sortRank` — the
 * sort expressions are never re-evaluated, so ties (no unique tiebreaker for
 * explicit sorts) stay consistent between the paged slice and the array order.
 *
 * @param params - See {@link BuildAdvancedAssetsQueryParams}.
 * @returns The complete `Prisma.Sql` query returning one row
 *   `{ total_count: number, assets: AdvancedIndexAsset[] }`.
 */
export function buildAdvancedAssetsQuery({
  whereClause,
  orderByInner,
  customFieldSortings,
  sortBy,
  parsedFilters,
  withBookings,
  withBarcodes,
  paginationClause,
  hasSearch,
}: BuildAdvancedAssetsQueryParams): Prisma.Sql {
  const customFieldSelect = generateCustomFieldSelect(customFieldSortings);

  const {
    qrId: qrIdSort,
    custody: custodySort,
    barcode: barcodeSort,
    kitName: kitNameSort,
    categoryName: categoryNameSort,
    assetModelName: assetModelNameSort,
    locationName: locationNameSort,
  } = detectActiveSortKeys(sortBy);

  // Custody joins are needed when EITHER a custody filter (WHERE references
  // custody_agg.custody) OR a custody sort (ORDER BY references the CASE) is
  // active. The custody CASE select itself is only needed for the sort.
  const custodyFilterActive = parsedFilters.some((f) => f.name === "custody");
  const custodyJoinsActive = custodyFilterActive || custodySort;

  // Base name-joins are gated so the slim phase stays O(1) joins under the
  // common default sort. Category/Location are also needed for text search
  // (its WHERE references c.name / l.name); the SELECT alias is only needed
  // when the matching name sort is active (search reads c.name/l.name directly).
  const needKitJoin = kitNameSort;
  const needCategoryJoin = categoryNameSort || hasSearch;
  const needAssetModelJoin = assetModelNameSort;
  const needLocationJoin = locationNameSort || hasSearch;

  const kitNameSelect = kitNameSort
    ? Prisma.sql`,
      k.name AS "kitName"`
    : Prisma.empty;
  const categoryNameSelect = categoryNameSort
    ? Prisma.sql`,
      c.name AS "categoryName"`
    : Prisma.empty;
  const assetModelNameSelect = assetModelNameSort
    ? Prisma.sql`,
      am.name AS "assetModelName"`
    : Prisma.empty;
  const locationNameSelect = locationNameSort
    ? Prisma.sql`,
      l.name AS "locationName"`
    : Prisma.empty;

  const qrIdSortSelect = qrIdSort
    ? Prisma.sql`,
      ${QR_ID_SUBQUERY} AS "qrId"`
    : Prisma.empty;
  const custodySortSelect = custodySort
    ? Prisma.sql`,
      ${CUSTODY_SORT_CASE} AS custody`
    : Prisma.empty;
  const barcodeSortSelects = barcodeSort
    ? Prisma.sql`,
      ${BARCODE_SORT_KEY_SELECTS}`
    : Prisma.empty;
  const custodyJoins = custodyJoinsActive ? CHEAP_CUSTODY_JOINS : Prisma.empty;

  const kitJoin = needKitJoin ? CHEAP_KIT_JOIN : Prisma.empty;
  const categoryJoin = needCategoryJoin ? CHEAP_CATEGORY_JOIN : Prisma.empty;
  const assetModelJoin = needAssetModelJoin
    ? CHEAP_ASSET_MODEL_JOIN
    : Prisma.empty;
  const locationJoin = needLocationJoin ? CHEAP_LOCATION_JOIN : Prisma.empty;
  const baseJoins = Prisma.sql`
    FROM public."Asset" a
    ${kitJoin}
    ${categoryJoin}
    ${assetModelJoin}
    ${locationJoin}`;

  // Hoisted out of the return template's interpolation on purpose: a nested
  // `Prisma.sql\`...\`` inside a `${}` inside the outer template tripped
  // esbuild's transform into silently dropping this whole function from the
  // bundle (tsc/vitest were fine, but the production build lost it).
  const rankOrderBy = Prisma.sql`saq."__sortRank"`;

  return Prisma.sql`
      WITH asset_query AS (
        -- SLIM cheap phase: id + sort keys, one row per matching asset, no
        -- GROUP BY. Cost is O(N) rows of LIGHT columns, not the heavy
        -- projection — that runs once per page row in the lateral below.
        SELECT
          a.id AS "assetId",
          a."createdAt" AS "assetCreatedAt",
          a."updatedAt" AS "assetUpdatedAt",
          a.value AS "assetValue",
          a.quantity AS "assetQuantity",
          a.title AS "assetTitle",
          a."sequentialId" AS "assetSequentialId",
          a.status AS "assetStatus",
          a.type AS "assetType",
          a.description AS "assetDescription",
          a."availableToBook" AS "assetAvailableToBook"${kitNameSelect}${categoryNameSelect}${assetModelNameSelect}${locationNameSelect}${qrIdSortSelect}${custodySortSelect}${barcodeSortSelects}${customFieldSelect}
        ${baseJoins}
        ${custodyJoins}
        ${whereClause}
      ),
      sorted_asset_query AS (
        -- Freeze the sort into a stable integer rank, then slice the page.
        SELECT
          "assetId",
          ROW_NUMBER() OVER (ORDER BY ${Prisma.raw(
            orderByInner
          )}) AS "__sortRank"
        FROM asset_query
        ORDER BY "__sortRank"
        ${paginationClause}
      ),
      count_query AS (
        -- Full filtered total (pagination-independent) over the slim CTE.
        SELECT COUNT(*)::integer AS total_count
        FROM asset_query
      )
      SELECT
        (SELECT total_count FROM count_query) AS total_count,
        ${assetReturnFragment({
          withBookings,
          withBarcodes,
          orderBy: rankOrderBy,
        })}
      FROM sorted_asset_query saq
      LEFT JOIN LATERAL (
        -- Heavy projection, run once per page row (WHERE a.id = the paged id).
        ${assetQueryFragment({
          withBookings,
          withBarcodes,
          withCustomFieldDefinitions: false,
        })}
        ${assetQueryJoins}
        WHERE a.id = saq."assetId"
        GROUP BY a.id, k.id, k.name, k.status, c.id, c.name, c.color, l.id, l."parentId", l.name, custody_agg.custody, kits_agg.kits, locations_agg.locations, b.id, bu.id, bu."firstName", bu."lastName", bu."profilePicture", bu.email, btm.id, btm.name, am.id, am.name
      ) aq ON TRUE;
    `;
}

export async function parseFiltersWithHierarchy(
  filtersString: string,
  columns: Column[],
  organizationId?: string
): Promise<Filter[]> {
  const parsed = parseFilters(filtersString, columns);
  if (!organizationId) return parsed;
  return expandLocationHierarchyFilters({ filters: parsed, organizationId });
}
