import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  MetaFunction,
} from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { BookingNotes } from "~/components/booking/notes";
import { ErrorContent } from "~/components/errors";
import { NoPermissionsIcon } from "~/components/icons/library";
import type { HeaderData } from "~/components/layout/header/types";
import { MarkdownNoteSchema } from "~/components/notes/markdown-note-form";
import TextualDivider from "~/components/shared/textual-divider";
import { db } from "~/database/db.server";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getBooking } from "~/modules/booking/service.server";
import {
  getBookingNotes,
  createBookingNote,
  deleteBookingNote,
} from "~/modules/booking-note/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
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

    return payload({ booking: { ...booking, notes: bookingNotes }, header });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const method = getActionMethod(request);

    if (method !== "POST" && method !== "DELETE") {
      throw notAllowedMethod(method);
    }

    /*
     * Permission required depends on the HTTP verb: POST creates a note,
     * DELETE removes one. Using a single `bookingNote.create` check for both
     * would let a role with only `create` delete notes it authored even when
     * the permission matrix does not grant `bookingNote.delete` to that role
     * (BASE / SELF_SERVICE have `create` + `read` but not `delete`).
     */
    const requiredAction =
      method === "DELETE" ? PermissionAction.delete : PermissionAction.create;

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.bookingNote,
      action: requiredAction,
    });

    /*
     * Validate that the booking belongs to the requester's current organization
     * BEFORE performing any note mutation. This closes the cross-organization
     * IDOR where an attacker in Org A could post/delete notes on Org B's
     * bookings simply by knowing the bookingId. The service layer enforces the
     * same invariant as defense-in-depth, but checking here produces a
     * consistent 404 response shape and avoids spurious side effects (e.g.
     * success toasts) prior to hitting the service.
     */
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { id: true },
    });

    if (!booking) {
      throw new ShelfError({
        cause: null,
        message: "Booking not found or access denied",
        additionalData: { userId, bookingId, organizationId },
        label: "Booking",
        status: 404,
        shouldBeCaptured: false,
      });
    }

    switch (method) {
      case "POST": {
        const { content } = parseData(
          await request.formData(),
          MarkdownNoteSchema,
          {
            additionalData: { userId, bookingId },
          }
        );

        await createBookingNote({
          content,
          userId,
          bookingId,
          organizationId,
        });

        sendNotification({
          title: "Note created",
          message: "Your note has been created successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return payload({ success: true });
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
          bookingId,
          userId,
          organizationId,
        });

        sendNotification({
          title: "Note deleted",
          message: "Your note has been deleted successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return payload({ success: true });
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    return data(error(reason), { status: reason.status });
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
