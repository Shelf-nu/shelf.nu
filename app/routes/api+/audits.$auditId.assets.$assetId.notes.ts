import { data } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import {
  createAuditAssetNote,
  deleteAuditAssetNote,
  getAuditAssetNotes,
  updateAuditAssetNote,
} from "~/modules/audit/asset-details.service.server";
import { makeShelfError } from "~/utils/error";
import { getParams, payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export type AuditAssetNoteLoaderData = Awaited<ReturnType<typeof loader>>;

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const { auditId, assetId } = getParams(
      params,
      z.object({ auditId: z.string(), assetId: z.string() }),
      { additionalData: { userId } }
    );

    const notes = await getAuditAssetNotes({
      auditSessionId: auditId,
      auditAssetId: assetId,
    });

    return data(payload({ notes }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const { auditId, assetId } = getParams(
      params,
      z.object({ auditId: z.string(), assetId: z.string() }),
      { additionalData: { userId } }
    );

    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    switch (intent) {
      case "create": {
        const content = formData.get("content") as string;
        if (!content?.trim()) {
          throw new Error("Note content is required");
        }

        const note = await createAuditAssetNote({
          content: content.trim(),
          userId,
          auditSessionId: auditId,
          auditAssetId: assetId,
        });

        return data(payload({ note }));
      }

      case "update": {
        const noteId = formData.get("noteId") as string;
        const content = formData.get("content") as string;

        if (!noteId || !content?.trim()) {
          throw new Error("Note ID and content are required");
        }

        const note = await updateAuditAssetNote({
          noteId,
          content: content.trim(),
          userId,
        });

        return data(payload({ note }));
      }

      case "delete": {
        const noteId = formData.get("noteId") as string;

        if (!noteId) {
          throw new Error("Note ID is required");
        }

        await deleteAuditAssetNote({
          noteId,
          userId,
        });

        return data(payload({ success: true }));
      }

      default:
        throw new Error(`Unknown intent: ${intent}`);
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
