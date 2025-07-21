import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import { duplicateBooking, getBooking } from "~/modules/booking/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const paramsSchema = z.object({ bookingId: z.string() });

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  const { bookingId } = getParams(params, paramsSchema);

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });

    const booking = await getBooking({
      id: bookingId,
      organizationId,
      request,
      userOrganizations,
    });

    return json(
      data({
        showModal: true,
        booking,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw reason;
  }
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  const { bookingId } = getParams(params, paramsSchema);

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });

    const newBooking = await duplicateBooking({
      bookingId,
      organizationId,
      userId,
      request,
    });

    sendNotification({
      title: "Booking duplicated",
      senderId: userId,
      icon: { name: "success", variant: "success" },
      message: `Booking "${newBooking.name}" has been duplicated.`,
    });

    return redirect(`/bookings/${newBooking.id}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export default function DuplicateBooking() {
  const { booking } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ error?: { message: string } }>();

  const disabled = useDisabled();

  return (
    <div>
      <h3 className="mb-2">Duplicate Booking: {booking.name}</h3>

      <div className="mb-4 text-sm text-gray-500">
        <p className="mb-2">
          You're about to duplicate the booking{" "}
          <strong className="text-black">{booking.name}</strong>.
        </p>
        <p>
          All current booking details will be copied. You can review and edit
          them later.
        </p>
      </div>

      {actionData?.error && (
        <div className="mb-4 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-500">{actionData.error.message}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          disabled={disabled}
          to=".."
        >
          Cancel
        </Button>

        <Form method="POST" className="flex-1">
          <Button className="w-full" disabled={disabled}>
            Confirm
          </Button>
        </Form>
      </div>
    </div>
  );
}
