import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { z } from "zod";
import { NewNoteSchema } from "~/components/assets/notes/new";
import { createNote, deleteNote } from "~/modules/asset/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, notAllowedMethod } from "~/utils/error";
import {
  data,
  error,
  getActionMethod,
  getParams,
  parseData,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
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
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const payload = parseData(await request.formData(), NewNoteSchema, {
          additionalData: { userId, assetId },
        });

        sendNotification({
          title: "Note created",
          message: "Your note has been created successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        const note = await createNote({
          ...payload,
          assetId,
          userId,
        });

        return json(data({ note }));
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

        return json(data(null));
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return json(error(reason), { status: reason.status });
  }
}
