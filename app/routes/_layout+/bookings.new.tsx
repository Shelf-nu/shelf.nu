import { OrganizationRoles } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { DateTime } from "luxon";
import { BookingForm, NewBookingFormSchema } from "~/components/booking/form";
import styles from "~/components/booking/styles.new.css?url";
import { db } from "~/database/db.server";

import { upsertBooking } from "~/modules/booking/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getClientHint, getHints } from "~/utils/client-hints";
import { setCookie } from "~/utils/cookies.server";
import { getBookingDefaultStartEndTimes } from "~/utils/date-fns";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

/**
 * In the case of bookings, when the user clicks "new", we automatically create the booking.
 * In order to not have to manage 2 different pages for new and view/edit we do some simple but big brain strategy
 * In the .new route we dont even return any html, we just create a draft booking and directly redirect to the .bookingId route.
 * This way all actions are available and its way easier to manage so in a way this works kind of like a resource route.
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, role } = await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });
    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

    const [teamMembers, org] = await Promise.all([
      /**
       * We need to fetch the team members to be able to display them in the custodian dropdown.
       */
      db.teamMember.findMany({
        where: {
          deletedAt: null,
          organizationId,
        },
        include: {
          user: true,
        },
        orderBy: {
          userId: "asc",
        },
      }),
      /** We create a teamMember entry to represent the org owner.
       * Most important thing is passing the ID of the owner as the userId as we are currently only supporting
       * assigning custody to users, not NRM.
       */
      db.organization.findUnique({
        where: {
          id: organizationId,
        },
        select: {
          owner: true,
        },
      }),
    ]);

    if (org?.owner) {
      teamMembers.push({
        id: "owner",
        name: "owner",
        user: org.owner,
        userId: org.owner.id as string,
        organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
    }

    const selfServiceUser = isSelfService
      ? teamMembers.find((member) => member.userId === authSession.userId)
      : undefined;

    if (isSelfService && !selfServiceUser) {
      throw new ShelfError({
        cause: null,
        message:
          "Seems like something is wrong with your user. Please contact support to get this resolved. Make sure to include the trace id seen below.",
        label: "Booking",
      });
    }

    return json(
      data({
        showModal: true,
        isSelfService,
        selfServiceUser,
        teamMembers,
      }),
      {
        headers: [
          setCookie(await setSelectedOrganizationIdCookie(organizationId)),
        ],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, role } = await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });
    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

    const formData = await request.formData();

    const payload = parseData(
      formData,
      NewBookingFormSchema(false, true, getHints(request)),
      {
        additionalData: { userId, organizationId },
      }
    );

    const { name, custodian } = payload;
    const hints = getHints(request);

    const fmt = "yyyy-MM-dd'T'HH:mm";

    const from = DateTime.fromFormat(
      formData.get("startDate")!.toString()!,
      fmt,
      {
        zone: hints.timeZone,
      }
    ).toJSDate();

    const to = DateTime.fromFormat(formData.get("endDate")!.toString()!, fmt, {
      zone: hints.timeZone,
    }).toJSDate();

    const booking = await upsertBooking(
      {
        custodianUserId: custodian?.userId,
        custodianTeamMemberId: custodian?.id,
        organizationId,
        name,
        from,
        to,
        creatorId: authSession.userId,
        ...(isSelfService && {
          custodianUserId: authSession.userId,
        }),
      },
      getClientHint(request)
    );

    sendNotification({
      title: "Booking saved",
      message: "Your booking has been saved successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    const manageAssetsUrl = `/bookings/${
      booking.id
    }/add-assets?${new URLSearchParams({
      // We force the as Date because we know that the booking.from and booking.to are set and exist at this point.
      bookingFrom: (booking.from as Date).toISOString(),
      bookingTo: (booking.to as Date).toISOString(),
      hideUnavailable: "true",
      unhideAssetsBookigIds: booking.id,
    })}`;

    return redirect(manageAssetsUrl);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export const handle = {
  name: "bookings.new",
};

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];
export default function NewBooking() {
  const { isSelfService, selfServiceUser } = useLoaderData<typeof loader>();
  const { startDate, endDate } = getBookingDefaultStartEndTimes();

  return (
    <div className="booking-inner-wrapper">
      <header className="mb-5">
        <h2>Create new booking</h2>
        <p>
          Choose a name for your booking, select a start and end time and choose
          the custodian. Based on the selected information, asset availability
          will be determined.
        </p>
      </header>
      <div>
        <BookingForm
          startDate={startDate}
          endDate={endDate}
          custodianUserId={
            isSelfService
              ? JSON.stringify({
                  id: selfServiceUser?.id,
                  name: selfServiceUser?.name,
                  userId: selfServiceUser?.userId,
                })
              : undefined
          }
        />
      </div>
    </div>
  );
}
