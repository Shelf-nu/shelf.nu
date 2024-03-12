import { json, type ActionFunctionArgs } from "@remix-run/node";
import { db } from "~/database";
import { createAssetsFromBackupImport } from "~/modules/asset";
import { getRequiredParam } from "~/utils";
import { csvDataFromRequest } from "~/utils/csv.server";
import { ShelfError } from "~/utils/error";
import { extractCSVDataFromBackupImport } from "~/utils/import.server";
import { requireAdmin } from "~/utils/roles.server";

export const action = async ({
  context,
  request,
  params,
}: ActionFunctionArgs) => {
  const authSession = context.getSession();
  try {
    await requireAdmin(authSession.userId);
    const organizationId = getRequiredParam(params, "organizationId");
    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      include: {
        owner: true,
      },
    });

    if (!organization) {
      // @TODO Solve error handling
      throw new ShelfError({
        cause: null,
        message: "Organization not found",
        label: "Organization",
      });
    }

    const csvData = await csvDataFromRequest({ request });
    if (csvData.length < 2) {
      // @TODO Solve error handling
      throw new ShelfError({
        cause: null,
        message: "CSV file is empty",
        label: "CSV",
      });
    }

    const backupData = extractCSVDataFromBackupImport(csvData);
    await createAssetsFromBackupImport({
      data: backupData,
      userId: organization.owner.id,
      organizationId,
    });
    return json({ success: true }, { status: 200 });
  } catch (error) {
    return json(
      {
        success: false,
        error: {
          // @ts-ignore
          message: error.message,
          details: {
            code: null,
          },
        },
      },
      { status: 400 }
    );
  }
};
