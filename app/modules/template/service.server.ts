import {
  AssetStatus,
  type Organization,
  type Template,
  type User,
} from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { getPublicFileURL, parseFileFormData } from "~/utils/storage.server";
import { createNote } from "../asset/service.server";

export async function createTemplate({
  name,
  type,
  description,
  signatureRequired,
  userId,
  organizationId,
}: Pick<Template, "name" | "type" | "description" | "signatureRequired"> & {
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  // Count the number of templates of same type for the user
  const sameExistingTemplateCount = await db.template.count({
    where: { type, userId },
  });

  const data = {
    name,
    type,
    description,
    signatureRequired,
    creator: {
      connect: {
        id: userId,
      },
    },
    organization: {
      connect: {
        id: organizationId,
      },
    },
    isDefault: sameExistingTemplateCount === 0,
  };

  const template = await db.template.create({ data });

  return template;
}

export async function updateTemplate({
  id,
  name,
  description,
  signatureRequired,
  userId,
}: Pick<Template, "id" | "name" | "description" | "signatureRequired"> & {
  userId: User["id"];
}) {
  const data = {
    name,
    description,
    signatureRequired,
  };

  const updatedTemplate = await db.template.update({
    where: { id },
    data,
  });

  /**
   * If the signatureRequired is true, we need to search through all the Custodies that
   * have this tempalate associated with it. We will check if the templateSigned is false.
   *
   * If it is false, this could mean a scenario that the custodian has the asset in custody
   * and wasn't required to sign the template. But since we are setting signatureRequired to true,
   * we need to set the asset custory to "AVAILABLE" and furthermore, ask the custodian to sign
   * the template via mailing them.
   */
  if (signatureRequired === true) {
    const custodies = await db.custody.findMany({
      where: {
        templateId: id,
        templateSigned: false,
      },
      include: {
        custodian: true,
      },
    });

    for (const custody of custodies) {
      // Set the asset status to AVAILABLE
      await db.asset.update({
        where: {
          id: custody.assetId,
        },
        data: {
          status: AssetStatus.AVAILABLE,
        },
      });

      // Send notifications
      await createNote({
        content: `The PDF template **${updatedTemplate.name}** now requires a signature. **${custody.custodian.name}** needs to sign the **${updatedTemplate.name}** template before receiving custody.`,
        type: "UPDATE",
        userId,
        assetId: custody.assetId,
      });
    }
  }

  return updateTemplate;
}

export async function updateTemplatePDF({
  request,
  pdfName,
  pdfSize,
  templateId,
  organizationId,
}: {
  request: Request;
  templateId: string;
  pdfName: string;
  pdfSize: number;
  organizationId: User["id"];
}) {
  const res = await db.template.findFirst({
    where: { id: templateId, organizationId },
    select: { name: true, pdfUrl: true },
  });

  if (!res) return null;

  const newFileName: string = `${organizationId}/${templateId}`;
  const fileData = await parseFileFormData({
    request,
    bucketName: "templates",
    newFileName,
    updateExisting: res.pdfUrl !== null && res.pdfUrl !== undefined,
  });

  const pdf = fileData.get("pdf") as string;

  if (!pdf) return null;

  const publicUrl = getPublicFileURL({
    bucketName: "templates",
    filename: newFileName,
  });

  const data = {
    pdfUrl: publicUrl + ".pdf",
    pdfSize,
    pdfName,
  };

  return db.template.update({
    where: { id: templateId, organizationId },
    data,
  });
}

export function makeInactive({
  id,
  organizationId,
}: Pick<Template, "id"> & { organizationId: Organization["id"] }) {
  return db.template.update({
    where: { id, organizationId },
    data: {
      isActive: false,
      isDefault: false,
    },
  });
}

export function makeActive({
  id,
  organizationId,
}: Pick<Template, "id"> & { organizationId: Organization["id"] }) {
  return db.template.update({
    where: { id, organizationId },
    data: {
      isActive: true,
    },
  });
}

export async function makeDefault({
  id,
  type,
  organizationId,
}: {
  id: Template["id"];
  type: Template["type"];
  organizationId: Organization["id"];
}) {
  // Make all the templates of the same type of the user non-default
  await db.template.updateMany({
    where: { type, organizationId },
    data: { isDefault: false },
  });

  // Make the selected template default
  return db.template.update({
    where: { id, organizationId },
    data: { isDefault: true },
  });
}

export async function getTemplateById(id: Template["id"]) {
  try {
    return await db.template.findUniqueOrThrow({
      where: {
        id,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Template not found",
      message:
        "The template you are trying to access does not exist or you do not have permission to access it.",
      additionalData: { id },
      label: "Template",
    });
  }
}

export async function getTemplates({
  organizationId,
  page = 1,
  perPage = 8,
}: {
  organizationId: Organization["id"];
  page?: number;
  perPage?: number;
}) {
  const where = {
    organizationId,
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
