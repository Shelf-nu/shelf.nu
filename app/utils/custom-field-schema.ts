import type { ZodRawShape } from "zod";
import { z } from "zod";

/** Returns the schema depending on the field type.
 * Also handles the required field error message.
 * This was greatly inspired and done with the help of @rphlmr (https://github.com/rphlmr)
 */
const getSchema = ({
  params,
  field_name,
  required = false,
}: {
  params: {
    invalid_type_error?: string | undefined;
    required_error?: string | undefined;
    description?: string | undefined;
  };
  field_name?: string | undefined;
  required?: boolean;
}) => {
  /** If the field is required, we set the correct field type using zod */
  const text = required
    ? z.string(params).min(1, {
        message: field_name
          ? `${field_name} is required`
          : `This field is required`,
      })
    : z.string(params).optional();

  return {
    text: text,
    number: z.number(params),
    date: z.date(params),
    boolean: z.boolean(params),
  } as Record<CustomFieldZodSchema["type"], z.ZodTypeAny>;
};

type CustomFieldZodSchema = {
  id: string;
  name: string;
  type: "text" | "number" | "date" | "boolean";
  helpText: string;
  required: boolean;
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
}: {
  result: { [key: string]: any };
}) => {
  /** Get the custom fields keys and values */
  const customFieldsKeys = Object.keys(result.data).filter((key) =>
    key.startsWith("cf-")
  );

  return customFieldsKeys.map((key) => {
    const id = key.split("-")[1];
    const value = result.data[key];
    return { id, value };
  });
};
