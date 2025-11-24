import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { z } from "zod";
import { MarkdownNoteSchema } from "~/components/notes/markdown-note-form";
import { db } from "~/database/db.server";
import { createNote, deleteNote } from "~/modules/note/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import {
  payload,
  error,
  getActionMethod,
  getParams,
  parseData,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export function loader({ params }: LoaderFunctionArgs) {
  const { assetId } = getParams(params, z.object({ assetId: z.string() }));

  return redirect(`/assets/${assetId}`);
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    // Validate that the asset belongs to the user's organization
    const asset = await db.asset.findUnique({
      where: { id: assetId },
      select: { id: true, organizationId: true },
    });

    if (!asset || asset.organizationId !== organizationId) {
      throw new ShelfError({
        cause: null,
        message: "Asset not found or access denied",
        additionalData: { userId, assetId },
        label: "Assets",
        status: 404,
      });
    }

    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const { content } = parseData(
          await request.formData(),
          MarkdownNoteSchema,
          {
            additionalData: { userId, assetId },
          }
        );

        sendNotification({
          title: "Note created",
          message: "Your note has been created successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        const note = await createNote({
          content,
          assetId,
          userId,
        });

        return payload({ note });
      }
      case "DELETE": {
        const { noteId } = parseData(
          await request.formData(),
          z.object({
            noteId: z.string(),
          }),
          {
            additionalData: { userId, assetId },
          }
        );

        sendNotification({
          title: "Note deleted",
          message: "Your note has been deleted successfully",
          icon: { name: "trash", variant: "error" },
          senderId: authSession.userId,
        });

        await deleteNote({
          id: noteId,
          userId,
        });

        return payload(null);
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return data(error(reason), { status: reason.status });
  }
}
