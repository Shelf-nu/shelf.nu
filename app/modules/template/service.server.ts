import { AssetStatus } from "@prisma/client";
import type { Prisma, Organization, Template, User } from "@prisma/client";
import { v4 } from "uuid";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { getPublicFileURL, parseFileFormData } from "~/utils/storage.server";
import { createNote } from "../note/service.server";

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
  try {
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
    } satisfies Prisma.TemplateCreateInput;

    return await db.template.create({ data });
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error creating template",
      message:
        "Something went wrong while creating the template. Please try again or contact support.",
      additionalData: { name, type, description, signatureRequired },
      label: "Template",
    });
  }
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
  try {
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
     * have this template associated with it. We will check if the templateSigned is false.
     *
     * If it is false, this could mean a scenario that the custodian has the asset in custody
     * and wasn't required to sign the template. But since we are setting signatureRequired to true,
     * we need to set the asset custody to "AVAILABLE" and furthermore, ask the custodian to sign
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

    return updatedTemplate;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error updating template",
      message:
        "Something went wrong while updating the template. Please try again or contact support.",
      additionalData: { id },
      label: "Template",
    });
  }
}

export async function createTemplateRevision({
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
  try {
    const template = await db.template.findUniqueOrThrow({
      where: { id: templateId, organizationId },
    });

    const pdfHash = v4();
    const newFileName = `${organizationId}/${templateId}/${pdfHash}`;
    const fileData = await parseFileFormData({
      request,
      bucketName: "templates",
      newFileName,
    });

    const pdf = fileData.get("pdf") as string;

    if (!pdf) return null;

    const publicUrl = await getPublicFileURL({
      bucketName: "templates",
      filename: newFileName,
    });

    const [updatedTemplate, newRevision] = await db.$transaction([
      // Update the latest revision of the template
      db.template.update({
        where: { id: templateId, organizationId },
        data: {
          lastRevision: template.lastRevision + 1,
        },
      }),

      // Create a new revision of the template PDF
      db.templateFile.create({
        data: {
          name: pdfName,
          size: pdfSize,
          url: `${publicUrl}.pdf`,
          revision: template.lastRevision + 1,
          templateId,
        },
      }),
    ]);

    return { updatedTemplate, newRevision };
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error updating template PDF",
      message:
        "Something went wrong while updating the template PDF. Please try again or contact support.",
      additionalData: { templateId },
      label: "Template",
    });
  }
}

export function toggleTemplateActiveState({
  id,
  organizationId,
  active,
}: Pick<Template, "id"> & {
  organizationId: Organization["id"];
  active: boolean;
}) {
  try {
    return db.template.update({
      where: { id, organizationId },
      data: {
        isActive: active,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error making template inactive",
      message:
        "Something went wrong while making the template inactive. Please try again or contact support.",
      additionalData: { id },
      label: "Template",
    });
  }
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
  try {
    // Make all the templates of the same type of the user non-default
    await db.template.updateMany({
      where: { type, organizationId },
      data: { isDefault: false },
    });

    // Make the selected template default
    return await db.template.update({
      where: { id, organizationId },
      data: { isDefault: true },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error making template default",
      message:
        "Something went wrong while making the template default. Please try again or contact support.",
      additionalData: { id },
      label: "Template",
    });
  }
}

export async function getTemplateById(id: Template["id"]) {
  try {
    const template = await db.template.findUniqueOrThrow({ where: { id } });
    return template;
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

export async function getLatestTemplateFile(id: Template["id"]) {
  try {
    const templateFile = await db.templateFile.findFirst({
      where: { templateId: id },
      orderBy: { revision: "desc" },
    });

    return templateFile;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error fetching template file",
      message:
        "Something went wrong while fetching the template file. Please try again or contact support.",
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
  try {
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
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error fetching templates",
      message:
        "Something went wrong while fetching the templates. Please try again or contact support.",
      additionalData: { organizationId },
      label: "Template",
    });
  }
}
