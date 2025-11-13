import { BookingStatus } from "@prisma/client";
import { useAtomValue } from "jotai";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  redirect,
  data,
  useLoaderData,
  Outlet,
  useMatches,
} from "react-router";
import { z } from "zod";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";

import { BookingStatusBadge } from "~/components/booking/booking-status-badge";
import { TimeRemaining } from "~/components/booking/time-remaining";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { Button } from "~/components/shared/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { useDisabled } from "~/hooks/use-disabled";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getBooking } from "~/modules/booking/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import type { RouteHandleWithName } from "~/modules/types";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import {
  error,
  getParams,
  payload,
  getCurrentSearchParams,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";

export const AvailabilityForBookingFormSchema = z.object({
  availableToBook: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  const searchParams = getCurrentSearchParams(request);

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    /**
     * If the org id in the params is different than the current organization id,
     * we need to redirect and set the organization id in the cookie
     * This is useful when the user is viewing a booking from a different organization that they are part of after clicking link in email
     */
    const orgId = searchParams.get("orgId");
    if (orgId && orgId !== organizationId) {
      return redirect(`/bookings/${bookingId}`, {
        headers: [setCookie(await setSelectedOrganizationIdCookie(orgId))],
      });
    }

    const booking = await getBooking({
      id: bookingId,
      organizationId: organizationId,
      userOrganizations,
      request,
    });

    const header: HeaderData = {
      title: booking.name,
    };

    return payload({
      booking,
      header,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason));
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header?.title) },
];

export default function AssetDetailsPage() {
  const name = useAtomValue(dynamicTitleAtom);
  const hasName = name !== "";
  const { booking } = useLoaderData<typeof loader>();
  const { roles } = useUserRoleHelper();

  const items = [
    { to: "overview", content: "Overview" },
    ...(userHasPermission({
      roles,
      entity: PermissionEntity.bookingNote,
      action: PermissionAction.read,
    })
      ? [{ to: "activity", content: "Activity" }]
      : []),
  ];
  const matches = useMatches();
  const currentRoute: RouteHandleWithName = matches[matches.length - 1];

  const shouldHideHeader = [
    "booking.overview.scan-assets",
    "booking.overview.checkin-assets",
  ].includes(currentRoute?.handle?.name);

  return (
    <div className="relative">
      {!shouldHideHeader && (
        <>
          <Header
            title={hasName ? name : booking.name}
            subHeading={
              <div
                key={booking.status}
                className="mt-1 flex flex-col items-start gap-2 md:flex-row md:items-center"
              >
                <BookingStatusBadge
                  status={booking.status}
                  custodianUserId={booking.custodianUserId || undefined}
                />
                <TimeRemaining
                  from={booking.from!}
                  to={booking.to!}
                  status={booking.status}
                />
              </div>
            }
            slots={{
              "right-of-title": <AddToCalendar />,
            }}
          />
          <HorizontalTabs items={items} />
        </>
      )}
      <div>
        <Outlet />
      </div>
    </div>
  );
}

const AddToCalendar = () => {
  const disabled = useDisabled();
  const { booking } = useLoaderData<typeof loader>();
  const isArchived = booking.status === BookingStatus.ARCHIVED;
  return (
    <div className="absolute right-4 top-3">
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              to={`cal.ics`}
              download={true}
              reloadDocument={true}
              disabled={disabled || isArchived}
              variant="secondary"
              icon="calendar"
              className={"whitespace-nowrap"}
            >
              Add to calendar
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">
              {disabled
                ? "Not possible to add to calendar due to booking status"
                : "Download this booking as a calendar event"}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};

export const ErrorBoundary = () => <ErrorContent />;
