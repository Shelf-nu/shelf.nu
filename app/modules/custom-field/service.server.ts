import {
  type CustomField,
  type Organization,
  type Prisma,
  type User,
} from "@prisma/client";
import { db } from "~/database";
import { badRequest } from "~/utils";
import { getDefinitionFromCsvHeader } from "~/utils/custom-fields";
import { handleUniqueConstraintError } from "~/utils/error";
import type { CustomFieldDraftPayload } from "./types";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

export async function createCustomField({
  name,
  helpText,
  type,
  required,
  organizationId,
  active,
  userId,
  options = [],
}: CustomFieldDraftPayload) {
  try {
    const customField = await db.customField.create({
      data: {
        name,
        helpText,
        type,
        required,
        active,
        options,
        organization: {
          connect: {
            id: organizationId,
          },
        },
        createdBy: {
          connect: {
            id: userId,
          },
        },
      },
    });
    return { customField, error: null };
  } catch (cause) {
    return handleUniqueConstraintError(cause, "Custom field");
  }
}

export async function getFilteredAndPaginatedCustomFields({
  organizationId,
  page = 1,
  perPage = 8,
  search,
}: {
  organizationId: Organization["id"];

  /** Page number. Starts at 1 */
  page?: number;

  /** Items to be loaded per page */
  perPage?: number;

  search?: string | null;
}) {
  const skip = page > 1 ? (page - 1) * perPage : 0;
  const take = perPage >= 1 ? perPage : 8; // min 1 and max 25 per page

  /** Default value of where. Takes the items belonging to current user */
  let where: Prisma.CustomFieldWhereInput = { organizationId };

  /** If the search string exists, add it to the where object */
  if (search) {
    where.name = {
      contains: search,
      mode: "insensitive",
    };
  }

  const [customFields, totalCustomFields] = await db.$transaction([
    /** Get the items */
    db.customField.findMany({
      skip,
      take,
      where,
      orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
    }),

    /** Count them */
    db.customField.count({ where }),
  ]);

  return { customFields, totalCustomFields };
}

export async function getCustomField({
  organizationId,
  id,
}: Pick<CustomField, "id"> & {
  organizationId: Organization["id"];
}) {
  const [customField] = await db.$transaction([
    /** Get the item */
    db.customField.findFirst({
      where: { id, organizationId },
    }),
  ]);

  return { customField };
}

export async function updateCustomField(payload: {
  id: CustomField["id"];
  name?: CustomField["name"];
  helpText?: CustomField["helpText"];
  type?: CustomField["type"];
  required?: CustomField["required"];
  active?: CustomField["active"];
  options?: CustomField["options"];
}) {
  try {
    const { id, name, helpText, required, active, options } = payload;
    //dont ever update type
    //updating type would require changing all custom field values to that type
    //which might fail when changing to incompatible type hence need a careful definition
    const data = {
      name,
      helpText,
      required,
      active,
      options,
    };

    const customField = await db.customField.update({
      where: { id },
      data: data,
    });
    return { customField, error: null };
  } catch (cause) {
    return handleUniqueConstraintError(cause, "Custom field");
  }
}

export async function upsertCustomField(
  definitions: CustomFieldDraftPayload[]
): Promise<Record<string, CustomField>> {
  const customFields: Record<string, CustomField> = {};

  for (const def of definitions) {
    let existingCustomField = await db.customField.findFirst({
      where: {
        name: {
          equals: def.name,
          mode: "insensitive",
        },
        organizationId: def.organizationId,
      },
    });

    if (!existingCustomField) {
      // @TODO not sure how to handle this case
      // @ts-ignore
      const { customField: newCustomField } = await createCustomField(def);
      customFields[def.name] = newCustomField;
    } else {
      if (existingCustomField.type !== def.type) {
        throw badRequest(
          `custom field with name ${def.name} already exist with diffrent type ${existingCustomField.type}`
        );
      }
      if (existingCustomField.type === "OPTION") {
        const newOptions = def.options?.filter(
          (op) => !existingCustomField?.options?.includes(op)
        );
        if (newOptions?.length) {
          //create non exisitng options
          const options = (existingCustomField?.options || []).concat(
            Array.from(new Set(newOptions))
          );
          // @ts-ignore
          const rsp: {
            customField: CustomField;
            error: null;
          } = await updateCustomField({
            id: existingCustomField.id,
            options,
          });
          existingCustomField = rsp.customField;
        }
      }
      customFields[def.name] = existingCustomField;
    }
  }

  return customFields;
}

export async function createCustomFieldsIfNotExists({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
}): Promise<Record<string, CustomField>> {
  //{CF header:[all options in csv combined]}
  const optionMap: Record<string, string[]> = {};
  //{CF header: definition to create}
  const fieldToDefDraftMap: Record<string, CustomFieldDraftPayload> = {};
  for (let item of data) {
    for (let k of Object.keys(item)) {
      if (k.startsWith("cf:")) {
        const def = getDefinitionFromCsvHeader(k);
        if (!fieldToDefDraftMap[k]) {
          fieldToDefDraftMap[k] = { ...def, userId, organizationId };
        }
        if (def.type === "OPTION") {
          optionMap[k] = (optionMap[k] || []).concat([item[k]]);
        }
      }
    }
  }

  for (const [customFieldDefStr, def] of Object.entries(fieldToDefDraftMap)) {
    if (def.type === "OPTION" && optionMap[customFieldDefStr]?.length) {
      def.options = optionMap[customFieldDefStr];
    }
  }

  return upsertCustomField(Object.values(fieldToDefDraftMap));
}

export async function getActiveCustomFields({
  organizationId,
}: {
  organizationId: string;
}) {
  return await db.customField.findMany({
    where: {
      organizationId,
      active: true,
    },
  });
}

export async function countAcviteCustomFields({
  organizationId,
}: {
  organizationId: string;
}) {
  return await db.customField.count({
    where: { organizationId, active: true },
  });
}
