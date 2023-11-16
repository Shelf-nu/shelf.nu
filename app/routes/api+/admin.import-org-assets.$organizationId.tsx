import { json, type ActionFunctionArgs } from "@remix-run/node";
import { db } from "~/database";
import { createAssetsFromBackupImport } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { getRequiredParam } from "~/utils";
import { csvDataFromRequest } from "~/utils/csv.server";
import { ShelfStackError } from "~/utils/error";
import { extractCSVDataFromBackupImport } from "~/utils/import.server";
import { requireAdmin } from "~/utils/roles.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  try {
    await requireAuthSession(request);
    await requireAdmin(request);
    const organizationId = getRequiredParam(params, "organizationId");
    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      include: {
        owner: true,
      },
    });

    if (!organization) {
      throw new ShelfStackError({ message: "Organization not found" });
    }

    const csvData = await csvDataFromRequest({ request });
    if (csvData.length < 2) {
      throw new ShelfStackError({ message: "CSV file is empty" });
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
