import { Prisma, CustomFieldType } from "@prisma/client";

import type {
  Filter,
  FilterFieldType,
  FilterOperator,
} from "~/components/assets/assets-index/advanced-filters/schema";
import type { CustomFieldSorting } from "./types";
import type { Column } from "../asset-index-settings/helpers";

// 1. Filtering
export function generateWhereClause(
  organizationId: string,
  search: string | null,
  filters: Filter[]
): Prisma.Sql {
  let whereClause = Prisma.sql`WHERE a."organizationId" = ${organizationId}`;

  if (search) {
    const words = search.trim().split(/\s+/).filter(Boolean);
    if (words.length > 0) {
      const searchVector = words.join(" & ");
      whereClause = Prisma.sql`${whereClause} AND (to_tsvector('english', a."title") @@ to_tsquery('english', ${searchVector}))`;
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
    case "in": {
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
    default:
      return whereClause;
  }
}

function addEnumFilter(whereClause: Prisma.Sql, filter: Filter): Prisma.Sql {
  if (filter.name === "status") {
    // Ensure the filter value is trimmed
    let trimmedValue;

    if (Array.isArray(filter.value)) {
      // If the value is an array, map through and trim only string values
      trimmedValue = filter.value.map((val) =>
        typeof val === "string" ? val.trim() : val
      );
    } else if (typeof filter.value === "string") {
      // If it's a single string value, trim it
      trimmedValue = filter.value.trim();
    } else {
      // For numbers or any other type, leave as is
      trimmedValue = filter.value;
    }

    switch (filter.operator) {
      case "is":
        return Prisma.sql`${whereClause} AND a.status = ${trimmedValue}::public."AssetStatus"`;
      case "isNot":
        return Prisma.sql`${whereClause} AND a.status != ${trimmedValue}::public."AssetStatus"`;
      case "in":
        return Prisma.sql`${whereClause} AND a.status = ANY(${trimmedValue}::public."AssetStatus"[])`;
      default:
        return whereClause;
    }
  }
  // Add handling for other enum fields if needed
  return whereClause;
}

function addRelationFilter(
  whereClause: Prisma.Sql,
  filter: Filter
): Prisma.Sql {
  const relationAliasMap: Record<string, string> = {
    location: "l",
    kit: "k",
    category: "c",
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
        type: key.startsWith("cf_") ? "customField" : getFilterFieldType(key),
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
 * Determines the FilterFieldType based on the field name
 * @param fieldName - The name of the field
 * @returns The corresponding FilterFieldType
 */
function getFilterFieldType(fieldName: string): FilterFieldType {
  if (fieldName.startsWith("cf_")) {
    return "customField";
  }

  switch (fieldName) {
    case "id":
    case "title":
    case "qrId": // relation
    case "location": // relation
    case "kit": // relation
    case "category": // relation
      return "string";
    case "status":
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
    default:
      // For custom fields, you might want to implement a more sophisticated logic
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

  switch (getFilterFieldType(field)) {
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
      orderByParts.push(`"${columnName}" ${field.direction}`);
    } else if (field.name === "qrId") {
      orderByParts.push(`"qrId" ${field.direction}`);
    } else if (field.name === "kit") {
      orderByParts.push(`"kitName" ${field.direction}`);
    } else if (field.name === "category") {
      orderByParts.push(`"categoryName" ${field.direction}`);
    } else if (field.name === "location") {
      orderByParts.push(`"locationName" ${field.direction}`);
    } else if (field.name === "custody") {
      orderByParts.push(`custody->>'name' ${field.direction}`);
    } else if (field.name.startsWith("cf_")) {
      const customFieldName = field.name.slice(3); // Remove 'cf_' prefix
      const alias = `cf_${customFieldName.replace(/\s+/g, "_")}`;
      customFieldSortings.push({
        name: customFieldName,
        valueKey: "raw",
        alias,
        fieldType: field.fieldType,
      });
      orderByParts.push(`${alias} ${field.direction}`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`Unknown sort field: ${field.name}`);
    }
  }

  const orderByClause =
    orderByParts.length > 0 ? `ORDER BY ${orderByParts.join(", ")}` : "";

  return { orderByClause, customFieldSortings };
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
    l.name AS "locationName",
    json_agg(DISTINCT jsonb_build_object('id', t.id, 'name', t.name)) AS tags,
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
    ) AS "customFields"
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
      'customFields', COALESCE(aq."customFields", '[]'::jsonb)
    )
  ) AS assets
`;
