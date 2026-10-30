import Markdoc from "@markdoc/markdoc";
import type { RenderableTreeNode } from "@markdoc/markdoc";
import type {
  CustomField,
  CustomFieldFormat,
  CustomFieldType,
} from "@prisma/client";
import { parseLinkInput } from "@shelf/links";
import { format } from "date-fns";
import type { ZodRawShape } from "zod";
import { z } from "zod";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import {
  formatDateBasedOnLocaleOnly,
  parseDateOnlyString,
} from "./client-hints";
import { ShelfError, isLikeShelfError } from "./error";
import { linkifyBareUrls } from "./markdoc-linkify";
import {
  optionalNumberFromString,
  requiredNumberFromString,
} from "./zod-numeric";
/** Returns the schema depending on the field type.
 * Also handles the required field error message.
 * This was greatly inspired and done with the help of @rphlmr (https://github.com/rphlmr)
 */
const getSchema = ({
  id,
  params,
  field_name,
  required = false,
  options,
  storedValue,
}: {
  id: string;
  params: {
    invalid_type_error?: string | undefined;
    required_error?: string | undefined;
    description?: string | undefined;
  };
  field_name?: string | undefined;
  required?: boolean;
  options?: CustomField["options"];
  /** The text the asset stores for this field now, when editing an asset. */
  storedValue?: string;
}) => {
  /** If the field is required, we set the correct field type using zod */
  const text = required
    ? z.string(params).min(1, {
        message: field_name
          ? `${field_name} is required`
          : `This field is required`,
      })
    : z.string(params).optional();

  const option = required
    ? z
        .string(params)
        .min(1, `${field_name ? field_name : "This field"} is required`)
    : z.string(params).optional();

  return {
    text,
    // Blank stays allowed (or refused by `required` above), and so does the
    // value the asset already stores, which may predate the Link format;
    // anything else must pass the rule `buildCustomFieldValue` applies.
    link: text.superRefine((value, ctx) => {
      if (!value?.trim() || value === storedValue) return;
      const input = parseLinkInput(value);
      if (!input.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: input.message });
      }
    }),
    multiline_text: text,
    date: text,
    boolean: z
      .string(params)
      .optional()
      .transform((val) => (val === "on" ? true : false)),
    option: option.transform((v, ctx) => {
      if (v && !options?.includes(v)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [`cf-${id}`],
          message: `${v} is not a valid option`,
        });
      }
      return v;
    }),
    // Blank must stay blank rather than coerce to 0: `z.coerce.number()` reads
    // `""` as zero, which stored a real zero for every optional numeric field the
    // operator left empty (the downstream blank guard cannot catch it, because by
    // then the value is the number 0, not an empty string).
    amount: required
      ? requiredNumberFromString({ fieldName: field_name })
      : optionalNumberFromString({ blank: null, fieldName: field_name }),
    number: required
      ? requiredNumberFromString({ fieldName: field_name })
      : optionalNumberFromString({ blank: null, fieldName: field_name }),
  } satisfies Record<CustomFieldZodSchema["type"], z.ZodTypeAny>;
};

export type CustomFieldZodSchema = {
  id: string;
  name: string;
  type:
    | "text"
    | "link"
    | "number"
    | "date"
    | "boolean"
    | "option"
    | "multiline_text"
    | "amount";
  helpText: string;
  required: boolean;
  options?: CustomField["options"];
};

/**
 * Describes one custom field definition for `mergedSchema`, the asset form's
 * validation. A Link-format TEXT field validates as a web link.
 *
 * @param def - An active custom field definition
 * @returns The field's entry for `mergedSchema({ customFields })`
 */
export function toCustomFieldZodSchema(
  def: Pick<
    CustomField,
    "id" | "name" | "helpText" | "required" | "type" | "format" | "options"
  >
): CustomFieldZodSchema {
  return {
    id: def.id,
    name: def.name,
    helpText: def.helpText ?? "",
    required: def.required,
    type:
      def.format === "LINK"
        ? "link"
        : (def.type.toLowerCase() as CustomFieldZodSchema["type"]),
    options: def.options,
  };
}

function buildSchema(
  fields: CustomFieldZodSchema[],
  storedValues: StoredCustomFieldTexts | undefined
) {
  let schema = z.object({});

  fields.forEach((field) => {
    const fieldSchema = z.object({
      [`cf-${field.id}`]: getSchema({
        id: field.id,
        params: {
          description: field.helpText,
          required_error: field.name
            ? `${field.name} is required`
            : `This field is required`,
        },
        field_name: field.name,
        required: field.required,
        options: field.options,
        storedValue: storedValues?.get(field.id),
      })[field.type],
    });

    schema = schema.merge(fieldSchema);
  });

  return schema;
}

/**
 * The text an asset stores for each of its custom fields, by field id: the
 * `raw` of every value whose `raw` is a string.
 *
 * Passed as `storedValues` to `mergedSchema` and
 * `extractCustomFieldValuesFromPayload` when an asset is edited, so a Link
 * field that still holds a value saved before it became a Link field does
 * not block saving the asset's other changes.
 */
export type StoredCustomFieldTexts = ReadonlyMap<string, string>;

/**
 * Reads {@link StoredCustomFieldTexts} from an asset's stored values.
 *
 * @param values - `AssetCustomFieldValue` rows (or their JSON) of one asset
 * @returns The stored text by custom field id
 */
export function storedCustomFieldTexts(
  values: readonly { customFieldId: string; value: unknown }[]
): StoredCustomFieldTexts {
  const texts = new Map<string, string>();
  for (const { customFieldId, value } of values) {
    if (
      typeof value === "object" &&
      value !== null &&
      "raw" in value &&
      typeof value.raw === "string"
    ) {
      texts.set(customFieldId, value.raw);
    }
  }
  return texts;
}

/**
 * The asset form's schema: `baseSchema` plus one `cf-<id>` entry per custom
 * field.
 *
 * @param args.storedValues - When editing an asset, what it stores now; a
 *   Link field accepts its stored value unchanged
 */
export const mergedSchema = <T extends ZodRawShape>({
  baseSchema,
  customFields,
  storedValues,
}: {
  baseSchema: z.ZodObject<T, any>;
  customFields: CustomFieldZodSchema[];
  storedValues?: StoredCustomFieldTexts;
}) => {
  const CustomSchema = buildSchema(customFields, storedValues);

  return baseSchema.merge(CustomSchema);
};

/** Takes the result of zod's safeParseAsync and extracts custom fields values from it
 * Custom fields need to be prefixed with `cf-`
 *
 * With `storedValues` (when editing an asset), a Link field whose submitted
 * value equals what the asset stores is left out, so its stored value stays
 * as it is and is never run through the Link rule.
 */
export const extractCustomFieldValuesFromPayload = ({
  payload,
  customFieldDef,
  storedValues,
}: {
  payload: { [key: string]: any };
  customFieldDef: CustomField[];
  storedValues?: StoredCustomFieldTexts;
}): ShelfAssetCustomFieldValueType[] => {
  /** Get the custom fields keys and values */
  const customFieldsKeys = Object.keys(payload).filter((key) =>
    key.startsWith("cf-")
  );

  return customFieldsKeys.flatMap((key) => {
    const id = key.split("-")[1];
    const fieldDef = customFieldDef.find((v) => v.id === id)!;
    const unchangedLink =
      fieldDef.format === "LINK" &&
      storedValues?.has(id) === true &&
      payload[key] === storedValues.get(id);
    if (unchangedLink) return [];
    const value = buildCustomFieldValue({ raw: payload[key] }, fieldDef);
    return [{ id, value } as ShelfAssetCustomFieldValueType];
  });
};

const NUMERIC_VALUE_GUIDANCE =
  "Expected format: Plain numbers with optional decimal separator (e.g., 600, 600.50, or 600,50). Currency symbols will be automatically removed.";

const CURRENCY_SYMBOLS_REGEX = /[$€£¥₹₽₩₪₫฿₴₦₲₵₡₺₨]/g;

function formatInvalidNumericMessage(
  fieldName: string,
  rawValue: unknown,
  options?: { assetTitle?: string }
) {
  const value =
    typeof rawValue === "string"
      ? rawValue.trim()
      : rawValue === undefined || rawValue === null
      ? ""
      : String(rawValue);
  const assetPart = options?.assetTitle
    ? ` (asset: '${options.assetTitle}')`
    : "";
  return `Custom field '${fieldName}'${assetPart}: Invalid value '${value}'.`;
}

/**
 * The subset of a custom-field definition needed to turn a raw cell into a
 * stored value.
 *
 * Narrow on purpose: a definition parsed from a CSV column header
 * (`getDefinitionFromCsvHeader`) has no database row behind it, so it carries
 * no `id`. A persisted `CustomField` satisfies this shape too, and its `id`
 * travels to Sentry when a numeric value is rejected.
 *
 * `format` is required so every hand-written select that feeds
 * `buildCustomFieldValue` must fetch it: a select without it would skip the
 * Link rule.
 */
export type CustomFieldDefinitionForValue = Pick<
  CustomField,
  "name" | "type" | "format"
> & {
  id?: string;
};

/**
 * Sanitizes and validates numeric input for AMOUNT and NUMBER custom fields.
 *
 * Accepted formats:
 * - Plain numbers: 600, 1234
 * - Decimal numbers with dot: 600.50
 * - Decimal numbers with comma: 600,50 (converted to dot)
 * - Negative numbers: -600, (600), 600-
 * - Currency symbols are stripped: $600, €1234
 *
 * Rejected formats:
 * - Thousand separators: 1,234 or 1.234.567
 * - Multiple decimal separators: 1.2.3
 * - Non-numeric characters: abc, 12abc
 * - Special numeric values: NaN, Infinity
 * - Scientific notation: 1e10
 *
 * @param raw - The raw input value (string or number)
 * @param def - The custom field definition
 * @returns Object with numericValue (number) and normalizedText (string representation)
 * @throws {ShelfError} If the value cannot be parsed as a valid finite number
 */
function sanitizeNumericInput(
  raw: unknown,
  def: CustomFieldDefinitionForValue
): { numericValue: number; normalizedText: string } {
  const throwInvalid = (reason?: string): never => {
    const baseMessage = formatInvalidNumericMessage(def.name, raw);
    const message = reason
      ? `${baseMessage} ${reason} ${NUMERIC_VALUE_GUIDANCE}`
      : `${baseMessage} ${NUMERIC_VALUE_GUIDANCE}`;

    throw new ShelfError({
      cause: null,
      label: "Custom fields",
      message,
      shouldBeCaptured: false,
      additionalData: {
        customFieldId: def.id,
        customFieldType: def.type,
        rawValue: raw == null ? raw : String(raw),
      },
    });
  };

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      throwInvalid();
    }
    return {
      numericValue: raw,
      normalizedText: raw.toString(),
    };
  }

  if (typeof raw === "string") {
    let value = raw.trim();

    if (!value) {
      throwInvalid();
    }

    let isNegative = false;

    if (value.startsWith("(") && value.endsWith(")")) {
      isNegative = true;
      value = value.slice(1, -1);
    }

    value = value.replace(CURRENCY_SYMBOLS_REGEX, "");

    if (value.endsWith("-")) {
      isNegative = true;
      value = value.slice(0, -1);
    }

    if (value.startsWith("-")) {
      isNegative = true;
      value = value.slice(1);
    }

    if (value.startsWith("+")) {
      value = value.slice(1);
    }

    // Count separators to detect thousand separators
    const dotCount = (value.match(/\./g) || []).length;
    const commaCount = (value.match(/,/g) || []).length;

    // Reject if multiple separators are present (indicates thousand separators)
    if (dotCount > 1 || commaCount > 1 || (dotCount > 0 && commaCount > 0)) {
      throwInvalid(
        "Contains thousand separator format (multiple dots/commas or mixed separators)."
      );
    }

    // Check for single separator used as thousand separator
    // Thousand separators typically have exactly 3 digits after them (e.g., 1,234 or 1.234)
    // Decimals typically have 0-2 digits after them (e.g., 600.5 or 600.50)
    if (commaCount === 1) {
      const parts = value.split(",");
      const afterComma = parts[1];
      // If exactly 3 digits after comma and more than 1 digit before, likely thousand separator
      if (afterComma.length === 3 && parts[0].length > 0) {
        throwInvalid(
          "Contains thousand separator format (comma with 3 digits after it)."
        );
      }
      value = value.replace(",", ".");
    } else if (dotCount === 1) {
      const parts = value.split(".");
      const afterDot = parts[1];
      // If exactly 3 digits after dot and more than 1 digit before, likely thousand separator
      if (afterDot.length === 3 && parts[0].length > 0) {
        throwInvalid(
          "Contains thousand separator format (dot with 3 digits after it)."
        );
      }
    }

    if (!/^[0-9]+(?:\.[0-9]+)?$/.test(value)) {
      throwInvalid("Contains non-numeric characters.");
    }

    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      throwInvalid("Value is not a finite number.");
    }

    const finalValue = isNegative ? -numericValue : numericValue;
    const normalizedText = `${isNegative ? "-" : ""}${value}`;

    return {
      numericValue: finalValue,
      normalizedText,
    };
  }

  return throwInvalid();
}

/** The only date format a custom field import accepts: YYYY-MM-DD. */
export const CUSTOM_FIELD_DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * UTC midnight of a calendar day, so the date stays the same in every time
 * zone.
 *
 * @param year - Full year
 * @param month - Month, 1 to 12
 * @param day - Day of the month
 * @returns The date, or `null` when the parts are not a real day: `Date`
 *   rolls 2026-02-31 over to 2026-03-03, which must never be stored
 */
export function utcCalendarDate(
  year: number,
  month: number,
  day: number
): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

/**
 * Whether a value is a date a custom field import accepts: YYYY-MM-DD and a
 * real calendar day. The caller decides whether to trim first.
 *
 * @param value - A CSV cell
 * @returns `true` when the importer would store it
 */
export function isImportableCustomFieldDate(value: string): boolean {
  const match = CUSTOM_FIELD_DATE_FORMAT.exec(value);
  return (
    match !== null &&
    utcCalendarDate(Number(match[1]), Number(match[2]), Number(match[3])) !==
      null
  );
}

/**
 * Reads a yes/no cell the way imports do. Case-insensitive, trims whitespace.
 *
 * @param value - Raw string from a CSV cell
 * @returns `true` for "yes", `false` for "no", `undefined` for anything else
 */
export function parseYesNo(value: string): boolean | undefined {
  const lower = value.trim().toLowerCase();
  if (lower === "yes") return true;
  if (lower === "no") return false;
  return undefined;
}

/**
 * Builds the stored value for one custom field from raw input. Every write
 * path (forms, inline edit, imports, the mobile API) goes through here, so a
 * type's rule holds everywhere.
 *
 * DATE values are stored with an ISO `valueDate` at UTC midnight, keeping the
 * intended day in every time zone. A Link-format TEXT field stores the
 * normalized link (`www.x.com/a.pdf` becomes `https://www.x.com/a.pdf`).
 *
 * @param value - The raw value and any additional field-specific values
 * @param def - The custom field definition
 * @returns The value to store, or undefined when the input is blank
 * @throws {ShelfError} When the input does not fit the field: not a number,
 *   not a YYYY-MM-DD day, or (400) not a web link for a Link field
 */
export const buildCustomFieldValue = (
  value: ShelfAssetCustomFieldValueType["value"],
  def: CustomFieldDefinitionForValue
): ShelfAssetCustomFieldValueType["value"] | undefined => {
  try {
    const { raw } = value;
    /** We handle boolean different because it returns false */
    if (
      def.type !== "BOOLEAN" &&
      (raw === undefined ||
        raw === null ||
        (typeof raw === "string" && raw.trim() === ""))
    ) {
      return undefined;
    }

    switch (def.type) {
      case "BOOLEAN": {
        let finalValue: boolean;
        if (typeof raw === "string") {
          const parsed = parseYesNo(raw);
          // An unrecognized string is skipped instead of coerced.
          if (parsed === undefined) return undefined;
          finalValue = parsed;
        } else {
          finalValue = Boolean(raw);
        }
        return { raw, valueBoolean: finalValue };
      }
      case "DATE": {
        // Store raw date as entered by user.
        // But format valueDate as ISO string with UTC midnight to satisfy DB constraint
        // while ensuring the date remains the same in all timezones.
        const dateOnly = (raw as string).trim(); // expected: YYYY-MM-DD

        // why: a stored date must be a real YYYY-MM-DD day. Any other shape is
        // refused, because Date.UTC turns "03-04-2026" into a valid but wrong
        // date that would then drive sorting, filters, reports and reminders;
        // utcCalendarDate refuses a day Date.UTC would roll over (2026-02-31).
        // The bulk-update diff applies the same rule via
        // isImportableCustomFieldDate.
        const match = CUSTOM_FIELD_DATE_FORMAT.exec(dateOnly);
        if (!match) {
          throw new ShelfError({
            cause: null,
            title: "Invalid date format",
            message: `Custom field '${def.name}' expects dates in YYYY-MM-DD format. The value we found is: '${dateOnly}'.`,
            label: "Custom fields",
            shouldBeCaptured: false,
          });
        }

        const utcDate = utcCalendarDate(
          Number(match[1]),
          Number(match[2]),
          Number(match[3])
        );
        if (!utcDate) {
          throw new ShelfError({
            cause: null,
            title: "Invalid date",
            message: `Custom field '${def.name}' received '${dateOnly}', which is not a real calendar date. Use the format YYYY-MM-DD.`,
            label: "Custom fields",
            shouldBeCaptured: false,
          });
        }

        return {
          raw: dateOnly,
          valueDate: utcDate.toISOString(), // Will be in format required by DB constraint
        };
      }
      case "OPTION":
        return { raw, valueOption: String(raw) };
      case "MULTILINE_TEXT":
        return { raw, valueMultiLineText: String(raw) };
      case "AMOUNT": {
        const { numericValue, normalizedText } = sanitizeNumericInput(raw, def);
        return { raw: numericValue, valueText: normalizedText };
      }
      case "NUMBER": {
        const { numericValue, normalizedText } = sanitizeNumericInput(raw, def);
        return { raw: numericValue, valueText: normalizedText };
      }
      case "TEXT": {
        if (def.format !== "LINK") break;
        const input = parseLinkInput(String(raw));
        if (!input.ok) {
          throw new ShelfError({
            cause: null,
            title: "Not a link",
            message: `Custom field '${def.name}': ${
              input.message
            }. The value we found is: '${String(raw)}'.`,
            label: "Custom fields",
            status: 400,
            shouldBeCaptured: false,
          });
        }
        return { raw: input.url, valueText: input.url };
      }
    }

    return { raw, valueText: String(raw) };
  } catch (cause) {
    if (isLikeShelfError(cause)) {
      throw cause;
    }

    throw new ShelfError({
      cause: cause,
      title:
        cause instanceof RangeError
          ? cause?.message
          : "Invalid custom field value",
      message: `Failed to read/process custom field value for '${
        def.name
      }' with type '${def.type}'. The value we found is: '${value.raw}'. ${
        def.type === "DATE"
          ? "Make sure to format your dates using the format: YYYY-MM-DD"
          : "Please verify the provided value matches the expected format"
      }`,
      label: "Custom fields",
      shouldBeCaptured: false,
    });
  }
};

export { formatInvalidNumericMessage as formatInvalidNumericCustomFieldMessage };

/**
 * Produce the human-readable display value for a stored custom-field value.
 *
 * @param value - The stored custom-field value shape
 * @param prefs - Optional resolved format prefs; when supplied, DATE values
 *   render in the user's configured order (absolute, no tz conversion).
 *   When omitted, falls back to `PPP` (server / prefs-less contexts).
 * @returns A string, or for MULTILINE_TEXT a renderable Markdoc node with
 *   bare URLs linked
 */
export const getCustomFieldDisplayValue = (
  value: ShelfAssetCustomFieldValueType["value"],
  prefs?: ResolvedFormatPrefs
): string | RenderableTreeNode => {
  if (value.valueMultiLineText) {
    return Markdoc.transform(
      linkifyBareUrls(Markdoc.parse(value.raw as string))
    );
  }

  if (Object.hasOwnProperty.call(value, "valueBoolean")) {
    return value.valueBoolean ? "Yes" : "No";
  }

  if (value.valueDate) {
    // Use raw date string directly for formatting
    // This ensures the date displayed matches the date entered
    return prefs
      ? formatDateBasedOnLocaleOnly(value.raw as string, prefs)
      : format(parseDateOnlyString(value.raw as string), "PPP");
  }

  return String(value.raw);
};

/**
 * The subset of a custom-field definition the asset-overview list needs.
 *
 * Deliberately narrow so BOTH sources satisfy it: the full `CustomField`
 * records returned by `getActiveCustomFields`, and the trimmed definition
 * nested inside each stored `AssetCustomFieldValue` row (see
 * `getAssetOverviewFields`).
 */
export type CustomFieldDefinitionForDisplay = {
  id: string;
  name: string;
  type: CustomFieldType;
  format: CustomFieldFormat;
  options: string[];
};

/** A stored custom-field value paired with the definition it belongs to. */
export type StoredCustomFieldValueForDisplay = {
  value: unknown;
  customField: CustomFieldDefinitionForDisplay;
};

/** One row of the asset-overview custom-fields list. */
export type AssetOverviewCustomField<
  TStored extends StoredCustomFieldValueForDisplay,
> = {
  /** The definition used to label and render the row */
  def: CustomFieldDefinitionForDisplay;
  /** The stored value, or `null` when the field has never been set */
  storedValue: TStored | null;
  /**
   * Whether this field appears in `editableDefinitions`. Always `false` for
   * view-only users, who receive none. A row can carry a value the caller is
   * not offered for editing (see the uncategorized-asset case below); the
   * route's action rejects those writes with a 400, so the UI must not present
   * an editor for them.
   */
  isEditable: boolean;
};

/**
 * Build the unified, alphabetically-sorted custom-fields list for the asset
 * overview page.
 *
 * The list is seeded from the asset's STORED VALUES — each one already carries
 * its own definition — and only then topped up with the org's editable
 * definitions, which produce the "Not set" placeholder rows.
 *
 * Seeding from the values is what makes the list permission-independent. The
 * loader only fetches `editableDefinitions` for users who can update the asset
 * (skipping three queries for view-only users), so a list built from those
 * alone renders empty for every BASE and SELF_SERVICE user. It also keeps a
 * value visible when its definition falls outside the editable set — an
 * uncategorized asset is offered only uncategorized definitions, yet may still
 * hold a value written while it belonged to a category.
 *
 * @param params.storedValues - The asset's custom-field value rows; rows with
 *   an empty `value` are treated as unset
 * @param params.editableDefinitions - Active definitions the user may fill in;
 *   pass an empty array for view-only users
 * @returns One entry per distinct definition, sorted by name. Neither input
 *   array is mutated.
 */
export function buildAssetOverviewCustomFields<
  TStored extends StoredCustomFieldValueForDisplay,
>({
  storedValues,
  editableDefinitions,
}: {
  storedValues: TStored[];
  editableDefinitions: CustomFieldDefinitionForDisplay[];
}): AssetOverviewCustomField<TStored>[] {
  const editableIds = new Set(editableDefinitions.map((def) => def.id));
  const rows = new Map<string, AssetOverviewCustomField<TStored>>();

  for (const storedValue of storedValues) {
    if (!storedValue.value) continue;
    rows.set(storedValue.customField.id, {
      def: storedValue.customField,
      storedValue,
      isEditable: editableIds.has(storedValue.customField.id),
    });
  }

  for (const def of editableDefinitions) {
    if (rows.has(def.id)) continue;
    rows.set(def.id, { def, storedValue: null, isEditable: true });
  }

  // Spread before sorting: `.sort()` is in-place, and these entries reference
  // arrays owned by the loader payload.
  return [...rows.values()].sort((a, b) =>
    a.def.name.localeCompare(b.def.name)
  );
}

/**
 * Reads the field definition a CSV column header declares, e.g.
 * `cf:Serial number,type:text` or `cf:Manual,type:text,format:link`.
 *
 * The type defaults to text. A `format:link` segment makes a text column a
 * Link field; on any other type it is ignored, since only text fields can
 * hold the Link format. The type is not checked here (see the import
 * preflight).
 *
 * @param header - A column header starting with `cf:`
 * @returns The definition to create the field with when it does not exist
 * @see {@link customFieldCsvHeader} for the header written for a field
 */
export const getDefinitionFromCsvHeader = (
  header: string
): Pick<
  CustomField,
  "helpText" | "name" | "type" | "format" | "required" | "active"
> => {
  const defArr = header.split(",").map((e) => e.trim()); //["cf:name","type:text"]
  const name = defArr
    .find((e: string) => e.toLowerCase().startsWith("cf:"))!
    .substring(3)
    .trim(); //name
  let type =
    defArr.find((e) => e.toLowerCase().startsWith("type:"))?.substring(5) ||
    "text"; //"text"
  type = type.trim().replace(/\s+/g, "_").toUpperCase();
  const format = defArr
    .find((e) => e.toLowerCase().startsWith("format:"))
    ?.substring(7)
    .trim()
    .toUpperCase();

  return {
    name,
    active: true,
    helpText: "",
    required: false,
    type: type as CustomFieldType,
    format: type === "TEXT" && format === "LINK" ? "LINK" : "PLAIN",
  };
};

/**
 * The CSV column header for a field, in the form `getDefinitionFromCsvHeader`
 * reads: `cf:Manual,type:TEXT,format:LINK` for a Link field,
 * `cf:Serial number,type:TEXT` otherwise.
 *
 * @param def - The field's name, type and format
 * @returns The header text
 */
export function customFieldCsvHeader(
  def: Pick<CustomField, "name" | "type" | "format">
): string {
  const header = `cf:${def.name},type:${def.type}`;
  return def.format === "LINK" ? `${header},format:${def.format}` : header;
}

// order of the keys control the UI form dorpdown order, so dont change unless u know what you are doing
export const FIELD_TYPE_NAME: { [key in CustomFieldType]: string } = {
  TEXT: "Single-line text",
  MULTILINE_TEXT: "Multi-line text",
  OPTION: "Option",
  BOOLEAN: "Boolean",
  DATE: "Date",
  AMOUNT: "Amount",
  NUMBER: "Number",
};

/**
 * The type of a field as the settings pages name it, with "(link)" added for a
 * Link-format text field.
 *
 * @param def - The field's type and format
 * @returns e.g. "Single-line text (link)"
 */
export function fieldTypeLabel(def: Pick<CustomField, "type" | "format">) {
  const name = FIELD_TYPE_NAME[def.type];
  return def.format === "LINK" ? `${name} (link)` : name;
}

/** Refusal for a Link format on a field that is not single-line text. */
export const LINK_FORMAT_NEEDS_TEXT_MESSAGE =
  "Only single-line text fields can be Link fields";
