import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { DateTime } from "luxon";
import { BookingForm, BookingFormSchema } from "~/components/booking/form";
import styles from "~/components/booking/styles.new.css?url";
import { db } from "~/database/db.server";
import { hasGetAllValue } from "~/hooks/use-model-filters";

import { createBooking } from "~/modules/booking/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import { getClientHint, getHints } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { setCookie } from "~/utils/cookies.server";
import { getBookingDefaultStartEndTimes } from "~/utils/date-fns";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  data,
  error,
  getCurrentSearchParams,
  parseData,
} from "~/utils/http.server";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const searchParams = getCurrentSearchParams(request);
  const assetIds = searchParams.getAll("assetId");
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization, isSelfServiceOrBase } =
      await requirePermission({
        userId: authSession?.userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.create,
      });

    if (isPersonalOrg(currentOrganization)) {
      throw new ShelfError({
        cause: null,
        title: "Not allowed",
        message:
          "You can't create bookings for personal workspaces. Please create a Team workspace to create bookings.",
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    /**
     * We need to fetch the team members to be able to display them in the custodian dropdown.
     */
    const teamMembersData = await getTeamMemberForCustodianFilter({
      organizationId,
      getAll:
        searchParams.has("getAll") &&
        hasGetAllValue(searchParams, "teamMember"),
      filterByUserId: isSelfServiceOrBase, // Self service or base users can only create bookings for themselves so we always filter by userId
      userId,
    });

    return json(
      data({
        userId,
        currentOrganization,
        showModal: true,
        isSelfServiceOrBase,
        ...teamMembersData,
        assetIds: assetIds.length ? assetIds : undefined,
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
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });

    const formData = await request.formData();
    const intent = formData.get("intent") as string;
    const hints = getHints(request);

    const payload = parseData(
      formData,
      BookingFormSchema({ hints, action: "new" }),
      {
        additionalData: { userId, organizationId },
      }
    );

    const { name, custodian, assetIds, description } = payload;

    /**
     * Validate if the user is self user and is assigning the booking to
     * him/herself only.
     */
    if (isSelfServiceOrBase) {
      const custodianFromDb = await db.teamMember.findFirst({
        where: { id: custodian.id },
        select: { id: true, userId: true },
      });

      if (custodianFromDb?.userId !== userId) {
        throw new ShelfError({
          cause: null,
          message: "Self user can assign booking to themselves only.",
          label: "Booking",
        });
      }
    }

    const from = DateTime.fromFormat(
      formData.get("startDate")!.toString()!,
      DATE_TIME_FORMAT,
      {
        zone: hints.timeZone,
      }
    ).toJSDate();

    const to = DateTime.fromFormat(
      formData.get("endDate")!.toString()!,
      DATE_TIME_FORMAT,
      {
        zone: hints.timeZone,
      }
    ).toJSDate();

    const booking = await createBooking({
      booking: {
        from,
        to,
        custodianTeamMemberId: custodian.id,
        custodianUserId: custodian?.userId ?? null,
        name: name!,
        description: description ?? null,
        organizationId,
        creatorId: authSession.userId,
      },
      assetIds: assetIds?.length ? assetIds : [],
      hints: getClientHint(request),
    });

    sendNotification({
      title: "Booking saved",
      message: "Your booking has been saved successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    const hasAssetIds = Boolean(assetIds);

    if (intent === "scan") {
      return redirect(`/bookings/${booking.id}/scan-assets`);
    }

    if (hasAssetIds) {
      return redirect(`/bookings/${booking.id}`);
    } else {
      const manageAssetsUrl = `/bookings/${
        booking.id
      }/add-assets?${new URLSearchParams({
        bookingFrom: (booking.from as Date).toISOString(),
        bookingTo: (booking.to as Date).toISOString(),
        hideUnavailable: "true",
        unhideAssetsBookigIds: booking.id,
      })}`;

      return redirect(manageAssetsUrl);
    }
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
  const { isSelfServiceOrBase, teamMembers, assetIds } =
    useLoaderData<typeof loader>();
  const { startDate, endDate } = getBookingDefaultStartEndTimes();
  // The loader already takes care of returning only the current user so we just get the first and only element in the array
  const custodianRef = isSelfServiceOrBase ? teamMembers[0]?.id : undefined;

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
          booking={{
            startDate,
            endDate,
            assetIds,
            custodianRef,
          }}
        />
      </div>
    </div>
  );
}
