import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { BookingNotes } from "~/components/booking/notes";
import { ErrorContent } from "~/components/errors";
import { NoPermissionsIcon } from "~/components/icons/library";
import type { HeaderData } from "~/components/layout/header/types";
import { MarkdownNoteSchema } from "~/components/notes/markdown-note-form";
import TextualDivider from "~/components/shared/textual-divider";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getBooking } from "~/modules/booking/service.server";
import {
  getBookingNotes,
  createBookingNote,
  deleteBookingNote,
} from "~/modules/booking-note/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getDateTimeFormat } from "~/utils/client-hints";
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
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { bookingId: id } = getParams(
    params,
    z.object({ bookingId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    // Parent route already enforces booking.read permission
    // Only check bookingNote.read permission here
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.bookingNote,
      action: PermissionAction.read,
    });

    const booking = await getBooking({ id, organizationId, request });

    const bookingNotes = await getBookingNotes({
      bookingId: id,
      organizationId,
    });

    const header: HeaderData = {
      title: `${booking.name}'s activity`,
    };
    const notes = bookingNotes.map((note) => ({
      ...note,
      dateDisplay: getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(note.createdAt),
      content: note.content, // Keep as string for client-side parsing
    }));

    return json(data({ booking: { ...booking, notes }, header }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason));
  }
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
          MarkdownNoteSchema,
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

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export default function BookingActivity() {
  const { roles } = useUserRoleHelper();
  const canReadBookingNotes = userHasPermission({
    roles,
    entity: PermissionEntity.bookingNote,
    action: PermissionAction.read,
  });

  return (
    <div className="w-full">
      {canReadBookingNotes ? (
        <>
          <TextualDivider text="Notes" className="mb-8 lg:hidden" />
          <BookingNotes />
        </>
      ) : (
        <div className="flex h-full flex-col justify-center">
          <div className="flex flex-col items-center justify-center  text-center">
            <div className="mb-4 inline-flex size-8 items-center justify-center  rounded-full bg-primary-100 p-2 text-primary-600">
              <NoPermissionsIcon />
            </div>
            <h5>Insufficient permissions</h5>
            <p>You are not allowed to view booking notes</p>
          </div>
        </div>
      )}
    </div>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
