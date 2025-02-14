import type { RenderableTreeNode } from "@markdoc/markdoc";
import type { CustomField, CustomFieldType } from "@prisma/client";
import { format } from "date-fns";
import type { ZodRawShape } from "zod";
import { z } from "zod";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import type { ClientHint } from "~/modules/booking/types";
import {
  formatDateBasedOnLocaleOnly,
  parseDateOnlyString,
} from "./client-hints";
import { ShelfError } from "./error";
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
    number: z.number(params),
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
  } as Record<CustomFieldZodSchema["type"], z.ZodTypeAny>;
};

export type CustomFieldZodSchema = {
  id: string;
  name: string;
  type: "text" | "number" | "date" | "boolean" | "option" | "multiline_text";
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
export const buildCustomFieldValue = (
  value: ShelfAssetCustomFieldValueType["value"],
  def: CustomField
): ShelfAssetCustomFieldValueType["value"] | undefined => {
  try {
    const { raw } = value;
    /** We handle boolean different because it returns false */
    if (def.type !== "BOOLEAN" && !raw) {
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
    }

    return { raw, valueText: String(raw) };
  } catch (cause) {
    throw new ShelfError({
      cause: cause,
      title:
        cause instanceof RangeError
          ? cause?.message
          : "Invalid custom field value",
      message: `Failed to read/process custom field value for '${def.name}' with type '${def.type}'. The value we found is: '${value.raw}'. Make sure to format your dates using the format: YYYY-MM-DD`,
      label: "Custom fields",
      shouldBeCaptured: false,
    });
  }
};

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
};
