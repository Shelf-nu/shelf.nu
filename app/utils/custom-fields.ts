import type { CustomField, CustomFieldType } from "@prisma/client";
import { format } from "date-fns"
import type { ZodRawShape } from "zod";
import { z } from "zod";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";

/** Returns the schema depending on the field type.
 * Also handles the required field error message.
 * This was greatly inspired and done with the help of @rphlmr (https://github.com/rphlmr)
 */
const getSchema = ({
  params,
  field_name,
  required = false,
  options
}: {
  params: {
    invalid_type_error?: string | undefined;
    required_error?: string | undefined;
    description?: string | undefined;
  };
  field_name?: string | undefined;
  required?: boolean;
  options?: CustomField["options"]
}) => {
  /** If the field is required, we set the correct field type using zod */
  const text = required
    ? z.string(params).min(1, {
      message: field_name
        ? `${field_name} is required`
        : `This field is required`,
    })
    : z.string(params).optional();

  const option = required ? z.string(params) : z.string(params).optional()

  return {
    text,
    multiline_text: text,
    number: z.number(params),
    date:text,
    boolean: z.string(params).optional().transform((val) => val === "on" ? true : false),
    option: option.transform((v, ctx) => {
      if (v && !options?.includes(v)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["option"],
          message: `${v} is not a valid option`,
        })
      }
      return v
    })
  } as Record<CustomFieldZodSchema["type"], z.ZodTypeAny>;
};

type CustomFieldZodSchema = {
  id: string;
  name: string;
  type: "text" | "number" | "date" | "boolean" | "option" | "multiline_text";
  helpText: string;
  required: boolean;
  options?: CustomField["options"]
};

function buildSchema(fields: CustomFieldZodSchema[]) {
  let schema = z.object({});

  fields.forEach((field) => {
    let fieldSchema = z.object({
      [`cf-${field.id}`]: getSchema({
        params: {
          description: field.helpText,
          required_error: field.name
            ? `${field.name} is required`
            : `This field is required`,
        },
        field_name: field.name,
        required: field.required,
        options: field.options
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
export const extractCustomFieldValuesFromResults = ({
  result,
  customFieldDef
}: {
  result: { [key: string]: any },
  customFieldDef: CustomField[]
}): ShelfAssetCustomFieldValueType[] => {
  /** Get the custom fields keys and values */
  const customFieldsKeys = Object.keys(result.data).filter((key) =>
    key.startsWith("cf-") && result.data[key] != ''
  );

  return customFieldsKeys.map((key) => {
    const id = key.split("-")[1];
    const value = buildCustomFieldValue({ raw: result.data[key] }, customFieldDef.find(v => v.id === id)!);
    return { id, value } as ShelfAssetCustomFieldValueType;
  });
};

export const buildCustomFieldValue = (value: ShelfAssetCustomFieldValueType["value"], def: CustomField): ShelfAssetCustomFieldValueType["value"] => {
  const { raw } = value

  switch (def.type) {
    case "BOOLEAN": return { raw, valueBoolean: Boolean(raw) };
    case "DATE": return { raw, valueDate: new Date(raw as string).toISOString() };
    case "OPTION": return { raw, valueOption: String(raw) };
    case "MULTILINE_TEXT": return { raw, valueMultiLineText: String(raw) };
  }

  return { raw, valueText: String(raw) }
}

export const getCustomFieldDisplayValue = (value: ShelfAssetCustomFieldValueType["value"]): string => {
  if (value.valueDate) {
    return format(new Date(value.valueDate), "PPP")
  }
  return String(value.raw)
}

//header = "cf:name,type:text"
export const getDefinitionFromCsvHeader = (header: string): Pick<CustomField, "helpText" | "name" | "type" | "required" | "active"> => {
  const defArr = header.split(",").map(e => e.trim()) //["cf:name","type:text"]
  const name = defArr.find((e: string) => e.toLowerCase().startsWith("cf:"))!.substring(3).trim(); //name
  let type = defArr.find(e => e.toLowerCase().startsWith("type:"))?.substring(5) || "text" //"text"
  type = type.replace(/\s+/g, "_").toUpperCase()
  return { name, active: true, helpText: "", required: false, type: type as CustomFieldType }
}

// order of the keys control the UI form dorpdown order, so dont change unless u know what you are doing
export const FIELD_TYPE_NAME: { [key in CustomFieldType]: string } = {
  TEXT: "Single-line text",
  MULTILINE_TEXT: "Multi-line text",
  OPTION: "Option",
  BOOLEAN: "Boolean",
  DATE: "Date",
}