import type { Template, User } from "@prisma/client";
import { db } from "~/database";
import { getPublicFileURL, parseFileFormData } from "~/utils/storage.server";

export async function createTemplate({
  name,
  type,
  description,
  signatureRequired,
  userId,
}: Pick<Template, "name" | "type" | "description" | "signatureRequired"> & {
  userId: User["id"];
}) {
  const data = {
    name,
    type,
    description,
    signatureRequired,
    user: {
      connect: {
        id: userId,
      },
    },
  };

  const template = await db.template.create({ data });
  
  // Check whether there are templates of same type for the user
  const result = await db.template.findMany({
      where: { type, userId },
  });
  // If there is only one template, make it default
  if (result.length === 1) {
      await db.template.update({
          where: { id: result[0].id },
          data: { isDefault: true },
      });
  }

  template.isDefault = result.length > 0 ? false : true;

  return template;
}

export async function updateTemplate({
  id,
  name,
  description,
  signatureRequired,
  userId,
}: Pick<
  Template,
  "id" | "name" | "description" | "signatureRequired"
> & {
  userId: User["id"];
}) {
  const data = {
    name,
    description,
    signatureRequired,
    user: {
      connect: {
        id: userId,
      },
    },
  };
  return db.template.update({
    where: { id, userId },
    data,
  });
}

export async function updateTemplatePDF({
  request,
  templateId,
  userId
}: {
  request: Request;
  templateId: string;
  userId: User["id"];
}) {
  const res = await db.template.findFirst({
    where: { id: templateId, userId },
    select: { name: true, pdfUrl: true }
  });

  if (!res) return null;

  const newFileName: string = `${userId}/${templateId}_${res.name.replace(/\s/g, "-").toLowerCase()}`;
  console.log('T/F: ', res.pdfUrl !== null && res.pdfUrl !== undefined)
  const fileData = await parseFileFormData({
    request,
    bucketName: "templates",
    newFileName,
    updateExisting: res.pdfUrl !== null && res.pdfUrl !== undefined
  })

  console.log('fileData: ', fileData)

  const pdf = fileData.get("pdf") as string;
  const pdfSize = parseInt(fileData.get("pdfSize") as string);

  if (!pdf) return null;

  const publicUrl = getPublicFileURL({ bucketName: "templates", filename: newFileName });

  const data = {
    pdfUrl: publicUrl + ".pdf",
    pdfSize
  };

  return db.template.update({
    where: { id: templateId, userId },
    data,
  });
}

export async function makeInactive({ id, userId }: Pick<Template, "id"> & { userId: User["id"] }) {
  return db.template.update({
    where: { id, userId },
    data: {
      isActive: false,
      isDefault: false,
    },
  });
}

export async function makeActive({id, userId}: Pick<Template, "id"> & { userId: User["id"] }) {
  return db.template.update({
    where: { id, userId },
    data: {
      isActive: true,
    },
  });
}

export async function makeDefault({
  id,
  type,
  userId,
}: {
  id: Template["id"];
  type: Template["type"];
  userId: User["id"];
}) {
  // Make all the templates of the same type of the user non-default
  await db.template.updateMany({
    where: { type, userId },
    data: { isDefault: false },
  });

  // Make the selected template default
  return db.template.update({
    where: { id, userId },
    data: { isDefault: true },
  });
}

export async function getTemplateById({
    id,
    userId,
    }: Pick<Template, "id"> & { userId: User["id"] }) {
    return db.template.findFirst({
        where: { id, userId },
    });
    }
    

export async function getTemplates({
  userId,
  page = 1,
  perPage = 8,
}: {
  userId: User["id"];
  page?: number;
  perPage?: number;
}) {
  const where = {
    userId,
  };

  const [templates, totalTemplates] = await Promise.all([
    db.template.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: perPage,
      skip: (page - 1) * perPage,
    }),
    db.template.count({ where }),
  ]);

  return { templates, totalTemplates };
}

export async function isTemplateDefaultForType({
  templateId,
  type,
  userId,
}: {
  templateId: Template["id"];
  type: Template["type"];
  userId: User["id"];
}) {
  const template = await db.template.findFirst({
    where: { id: templateId, type, userId },
  });

  return template?.isDefault;
}
