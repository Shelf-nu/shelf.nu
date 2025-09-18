import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { z } from "zod";
import { NewBookingNoteSchema } from "~/components/booking/notes/new";
import {
  createBookingNote,
  deleteBookingNote,
} from "~/modules/booking-note/service.server";
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
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export function loader({ params }: LoaderFunctionArgs) {
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }));

  return redirect(`/bookings/${bookingId}`);
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.bookingNote,
      action: PermissionAction.create,
    });

    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const payload = parseData(
          await request.formData(),
          NewBookingNoteSchema,
          {
            additionalData: { userId, bookingId },
          }
        );

        sendNotification({
          title: "Note created",
          message: "Your note has been created successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        await createBookingNote({
          content: payload.content,
          userId,
          bookingId,
        });

        return json(data({ success: true }));
      }

      case "DELETE": {
        const { noteId } = parseData(
          await request.formData(),
          z.object({
            noteId: z.string(),
          }),
          { additionalData: { userId, bookingId } }
        );

        await deleteBookingNote({
          id: noteId,
          userId,
        });

        sendNotification({
          title: "Note deleted",
          message: "Your note has been deleted successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ success: true }));
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    return json(error(reason), { status: reason.status });
  }
}
