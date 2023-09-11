import {
  CustomFieldType,
  type CustomField,
  type Organization,
  type Prisma,
  type User,
} from "@prisma/client";
import { db } from "~/database";
import type { CreateAssetFromContentImportPayload } from "../asset";

export async function createCustomField({
  name,
  helpText,
  type,
  required,
  organizationId,
  active,
  userId,
}: Pick<CustomField, "helpText" | "name" | "type" | "required" | "active"> & {
  organizationId: Organization["id"];
  userId: User["id"];
}) {
  return db.customField.create({
    data: {
      name,
      helpText,
      type,
      required,
      active,
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
}) {
  const { id, name, helpText, type, required, active } = payload;
  const data = {
    name,
    type,
    helpText,
    required,
    active,
  };

  return await db.customField.update({
    where: { id },
    data: data,
  });
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
  // This is the list of all the custom fields keys
  // It should have only unique entries
  const customFieldsKeys = data
    .map((item) => Object.keys(item).filter((k) => k.startsWith("cf:")))
    .flat()
    .filter((v, i, a) => a.indexOf(v) === i);

  /** Based on those keys we need to check if custom fields with those names exist */
  const customFields = {};

  for (const customFieldName of customFieldsKeys) {
    const name = customFieldName.replace("cf:", "").trim();

    const existingCustomField = await db.customField.findFirst({
      where: {
        name: name,
        organizationId,
      },
    });

    if (!existingCustomField) {
      const newCustomField = await createCustomField({
        organizationId,
        userId,
        name,
        type: CustomFieldType.TEXT,
        required: false,
        helpText: "",
        active: true,
      });
      // Assign the new custom field to all values associated with the name
      for (const item of data) {
        if (item.hasOwnProperty(customFieldName)) {
          const value = item[customFieldName];
          if (value !== "") {
            Object.assign(customFields, { [value]: newCustomField });
          }
        }
      }
    } else {
      // Assign the existing custom field to all values associated with the name
      for (const item of data) {
        if (item.hasOwnProperty(customFieldName)) {
          const value = item[customFieldName];
          if (value !== "") {
            Object.assign(customFields, { [value]: existingCustomField });
          }
        }
      }
    }
  }

  return customFields;
}
