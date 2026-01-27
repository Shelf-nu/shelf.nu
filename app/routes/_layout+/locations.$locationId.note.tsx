import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { z } from "zod";
import { MarkdownNoteSchema } from "~/components/notes/markdown-note-form";
import { db } from "~/database/db.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
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
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import {
  createLocationNote,
  deleteLocationNote,
} from "~/modules/location-note/service.server";

const paramsSchema = z.object({ locationId: z.string() });

export function loader({ params }: LoaderFunctionArgs) {
  const { locationId } = getParams(params, paramsSchema);

  return redirect(`/locations/${locationId}/activity`);
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { locationId } = getParams(params, paramsSchema, {
    additionalData: { userId },
  });

  try {
    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const { organizationId } = await requirePermission({
          userId,
          request,
          entity: PermissionEntity.locationNote,
          action: PermissionAction.create,
        });

        await assertLocationBelongsToOrganization({
          locationId,
          organizationId,
        });

        const payload = parseData(
          await request.formData(),
          MarkdownNoteSchema,
          {
            additionalData: { userId, locationId },
          }
        );

        const note = await createLocationNote({
          content: payload.content,
          locationId,
          userId,
        });

        sendNotification({
          title: "Note created",
          message: "Your location note has been created successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(data({ note }));
      }
      case "DELETE": {
        const { organizationId } = await requirePermission({
          userId,
          request,
          entity: PermissionEntity.locationNote,
          action: PermissionAction.delete,
        });

        await assertLocationBelongsToOrganization({
          locationId,
          organizationId,
        });

        const { noteId } = parseData(
          await request.formData(),
          z.object({ noteId: z.string() }),
          {
            additionalData: { userId, locationId },
          }
        );

        await deleteLocationNote({
          id: noteId,
          userId,
        });

        sendNotification({
          title: "Note deleted",
          message: "Your location note has been deleted successfully",
          icon: { name: "trash", variant: "error" },
          senderId: authSession.userId,
        });

        return json(data(null));
      }
      default: {
        throw notAllowedMethod(method);
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { locationId, userId });
    return json(error(reason), { status: reason.status });
  }
}

async function assertLocationBelongsToOrganization({
  locationId,
  organizationId,
}: {
  locationId: string;
  organizationId: string;
}) {
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { organizationId: true },
  });

  if (!location || location.organizationId !== organizationId) {
    throw new ShelfError({
      cause: null,
      message: "Location not found or access denied",
      status: 404,
      additionalData: { locationId, organizationId },
      label: "Location",
    });
  }
}
