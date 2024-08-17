import type { CustomField, CustomFieldType } from "@prisma/client";
import { format } from "date-fns";
import { DateTime } from "luxon";
import type { ZodRawShape } from "zod";
import { z } from "zod";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import type { ClientHint } from "~/modules/booking/types";
import { getDateTimeFormatFromHints } from "./client-hints";
import { ShelfError } from "./error";

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
  timeZone,
}: {
  payload: { [key: string]: any };
  customFieldDef: CustomField[];
  isDuplicate?: boolean;
  timeZone?: ClientHint["timeZone"];
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
      const value = buildCustomFieldValue(
        { raw: payload[key] },
        fieldDef!,
        timeZone
      );
      return { id, value } as ShelfAssetCustomFieldValueType;
    })
    .filter((v) => v !== null) as ShelfAssetCustomFieldValueType[];
};

export const buildCustomFieldValue = (
  value: ShelfAssetCustomFieldValueType["value"],
  def: CustomField,
  timeZone?: ClientHint["timeZone"]
): ShelfAssetCustomFieldValueType["value"] | undefined => {
  try {
    const { raw } = value;

    if (!raw) {
      return undefined;
    }

    // console.log(raw ?DateTime.fromFormat(raw.toString(), 'yyyy-MM-dd', {
    //   zone: timeZone,
    // }).toString(): "" )

    switch (def.type) {
      case "BOOLEAN":
        return { raw, valueBoolean: Boolean(raw) };
      case "DATE":
        let value = raw as string;
        if (timeZone) {
          value = raw
            ? DateTime.fromFormat(raw.toString(), "yyyy-MM-dd", {
                zone: timeZone,
              }).toString()
            : "";
        }
        return {
          raw,
          valueDate: value ? new Date(value as string).toISOString() : "",
        };
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
      message: `Failed to read/process custom field value for '${def.name}' with type '${def.type}'. The value we found is: '${value.raw}'. Make sure to format your dates using the format: mm/dd/yyyy`,
      label: "Custom fields",
    });
  }
};

export const getCustomFieldDisplayValue = (
  value: ShelfAssetCustomFieldValueType["value"],
  hints?: ClientHint
): string => {
  if (value.valueDate) {
    if (hints) {
      const dateFormatter = getDateTimeFormatFromHints(hints, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(value.valueDate));
      const [month, day, year] = dateFormatter.split("/");
      // Rearrange the components into YYYY-MM-DD format
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    return format(new Date(value.valueDate), "PPP"); // Fallback to default date format
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
  type = type.replace(/\s+/g, "").toUpperCase();
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
