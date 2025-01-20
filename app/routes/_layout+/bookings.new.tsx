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
import { hasGetAllValue } from "~/hooks/use-model-filters";

import { upsertBooking } from "~/modules/booking/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import { getClientHint, getHints } from "~/utils/client-hints";
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
      isSelfService: isSelfServiceOrBase, // we can assume this is false because this view is not allowed for
      userId,
    });

    return json(
      data({
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

    const payload = parseData(
      formData,
      NewBookingFormSchema(false, true, getHints(request)),
      {
        additionalData: { userId, organizationId },
      }
    );

    const { name, custodian, assetIds, description } = payload;
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
        name,
        description,
        from,
        to,
        assetIds,
        creatorId: authSession.userId,
        ...(isSelfServiceOrBase && {
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
          startDate={startDate}
          endDate={endDate}
          assetIds={assetIds}
          custodianRef={custodianRef}
        />
      </div>
    </div>
  );
}
