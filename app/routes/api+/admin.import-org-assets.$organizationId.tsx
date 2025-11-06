import { data, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database/db.server";
import { createAssetsFromBackupImport } from "~/modules/asset/service.server";
import { csvDataFromRequest } from "~/utils/csv.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import { extractCSVDataFromBackupImport } from "~/utils/import.server";
import { requireAdmin } from "~/utils/roles.server";

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { organizationId } = getParams(
    params,
    z.object({ organizationId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    await requireAdmin(userId);

    const organization = await db.organization
      .findUniqueOrThrow({
        where: { id: organizationId },
        include: {
          owner: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "No organization found",
          additionalData: { userId, organizationId },
          label: "Organization",
        });
      });

    const csvData = await csvDataFromRequest({ request });

    if (csvData.length < 2) {
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

    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, organizationId });
    return data(error(reason), { status: reason.status });
  }
}
