import type { RenderableTreeNode } from "@markdoc/markdoc";
import type { CustomField, CustomFieldType } from "@prisma/client";
import { format } from "date-fns";
import type { ZodRawShape } from "zod";
import { z } from "zod";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import type { ClientHint } from "~/utils/client-hints";
import {
  formatDateBasedOnLocaleOnly,
  parseDateOnlyString,
} from "./client-hints";
import { ShelfError, isLikeShelfError } from "./error";
import { parseMarkdownToReact } from "./md";
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
    amount: required
      ? z.coerce.number().refine((value) => value !== 0, "Please enter a value")
      : z.coerce.number(params).optional().nullable(),
    number: required
      ? z.coerce.number().refine((value) => value !== 0, "Please enter a value")
      : z.coerce.number(params).optional().nullable(),
  } as Record<CustomFieldZodSchema["type"], z.ZodTypeAny>;
};

export type CustomFieldZodSchema = {
  id: string;
  name: string;
  type:
    | "text"
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

function buildSchema(fields: CustomFieldZodSchema[]) {
  let schema = z.object({});

  fields.forEach((field) => {
    let fieldSchema = z.object({
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
      })[field.type],
    });

    schema = schema.merge(fieldSchema);
  });

  return schema;
}

export const mergedSchema = <T extends ZodRawShape>({
  baseSchema,
  customFields,
}: {
  baseSchema: z.ZodObject<T, any>;
  customFields: CustomFieldZodSchema[];
}) => {
  const CustomSchema = buildSchema(customFields);

  return baseSchema.merge(CustomSchema);
};

/** Takes the result of zod's safeParseAsync and extracts custom fields values from it
 * Custom fields need to be prefixed with `cf-`
 */
export const extractCustomFieldValuesFromPayload = ({
  payload,
  customFieldDef,
  isDuplicate,
}: {
  payload: { [key: string]: any };
  customFieldDef: CustomField[];
  isDuplicate?: boolean;
}): ShelfAssetCustomFieldValueType[] => {
  /** Get the custom fields keys and values */
  const customFieldsKeys = Object.keys(payload).filter((key) =>
    key.startsWith("cf-")
  );

  return customFieldsKeys
    .map((key) => {
      const id = key.split("-")[1];
      const fieldDef = customFieldDef.find((v) => v.id === id)!;
      //making sure that duplicate creation is handled.
      if (!fieldDef && isDuplicate) {
        return null;
      }
      const value = buildCustomFieldValue({ raw: payload[key] }, fieldDef!);
      return { id, value } as ShelfAssetCustomFieldValueType;
    })
    .filter((v) => v !== null) as ShelfAssetCustomFieldValueType[];
};

/**
 * Builds a custom field value based on the field definition and raw input
 * For date fields, ensures dates are stored in ISO format required by DB constraints
 * while preserving the intended date regardless of timezone
 *
 * @param value - The raw value and any additional field-specific values
 * @param def - The custom field definition
 * @returns Formatted custom field value or undefined if no valid value
 */
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
  def: CustomField
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

export const buildCustomFieldValue = (
  value: ShelfAssetCustomFieldValueType["value"],
  def: CustomField
): ShelfAssetCustomFieldValueType["value"] | undefined => {
  try {
    const { raw } = value;
    /** We handle boolean different because it returns false */
    if (
      def.type !== "BOOLEAN" &&
      (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === ""))
    ) {
      return undefined;
    }

    switch (def.type) {
      case "BOOLEAN": {
        const finalValue =
          typeof raw === "string" ? raw === "yes" : Boolean(raw);
        return { raw, valueBoolean: finalValue };
      }
      case "DATE": {
        // Store raw date as entered by user
        // But format valueDate as ISO string with UTC midnight to satisfy DB constraint
        // while ensuring the date remains the same in all timezones
        const dateOnly = raw as string; // YYYY-MM-DD
        const [year, month, day] = dateOnly.split("-").map(Number);

        // Create date at UTC midnight to preserve the date across all timezones
        const utcDate = new Date(Date.UTC(year, month - 1, day));

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
 * Returns a display value for a custom field based on its type
 * For dates, uses the raw date string to avoid timezone conversions
 *
 * @param value - The custom field value to display
 * @param hints - Client hints containing locale information
 * @returns Formatted display value as string or markdown node
 */
export const getCustomFieldDisplayValue = (
  value: ShelfAssetCustomFieldValueType["value"],
  hints?: ClientHint
): string | RenderableTreeNode => {
  if (value.valueMultiLineText) {
    return parseMarkdownToReact(value.raw as string);
  }

  if (Object.hasOwnProperty.call(value, "valueBoolean")) {
    return value.valueBoolean ? "Yes" : "No";
  }

  if (value.valueDate) {
    // Use raw date string directly for formatting
    // This ensures the date displayed matches the date entered
    return hints
      ? formatDateBasedOnLocaleOnly(value.raw as string, hints.locale)
      : format(parseDateOnlyString(value.raw as string), "PPP");
  }

  return String(value.raw);
};

//header = "cf:name,type:text"
export const getDefinitionFromCsvHeader = (
  header: string
): Pick<CustomField, "helpText" | "name" | "type" | "required" | "active"> => {
  const defArr = header.split(",").map((e) => e.trim()); //["cf:name","type:text"]
  const name = defArr
    .find((e: string) => e.toLowerCase().startsWith("cf:"))!
    .substring(3)
    .trim(); //name
  let type =
    defArr.find((e) => e.toLowerCase().startsWith("type:"))?.substring(5) ||
    "text"; //"text"

  type = type.trim().replace(/\s+/g, "_").toUpperCase();
  return {
    name,
    active: true,
    helpText: "",
    required: false,
    type: type as CustomFieldType,
  };
};

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
