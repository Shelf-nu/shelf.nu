import type { ZodObject } from "zod";
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
  let schema: ZodObject<any, any> = z.object({});

  fields.forEach((field) => {
    let fieldSchema: ZodObject<any, any> = z.object({
      [field.id]: getSchema({
        params: {
          description: field.helpText,
        },
        field_name: field.name,
        required: field.required,
      })[field.type],
    });

    schema = schema.merge(fieldSchema);
  });

  return schema;
}

export const mergedSchema = ({
  baseSchema,
  customFields,
}: {
  baseSchema: z.ZodObject<any, any>;
  customFields: CustomFieldZodSchema[];
}) => {
  const CustomSchema = buildSchema(customFields);

  return baseSchema.merge(CustomSchema);
};
