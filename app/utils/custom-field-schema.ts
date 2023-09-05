import { z } from "zod";

const getSchema = (params: {
  invalid_type_error?: string | undefined;
  required_error?: string | undefined;
  description?: string | undefined;
}) =>
  ({
    text: z.string(params),
    number: z.number(params),
    date: z.date(params),
    boolean: z.boolean(params),
  } as Record<CustomFieldZodSchema["type"], z.ZodTypeAny>);

type CustomFieldZodSchema = {
  id: string;
  name: string;
  type: "text" | "number" | "date" | "boolean";
  helpText: string;
  required: boolean;
};

function buildSchema(fields: CustomFieldZodSchema[]) {
  const schema = z.object({});

  fields.forEach((field) => {
    // console.log(field.type);
    const fieldSchema = getSchema({ description: field.helpText })[field.type];

    if (!field.required) {
      fieldSchema.optional();
    }

    schema.setKey(field.id, fieldSchema);
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
