import { json } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { BookingForm, NewBookingFormSchema } from "~/components/booking";
import ContextualModal from "~/components/layout/contextual-modal";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Badge } from "~/components/shared";
import { db } from "~/database";
import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import {
  assertIsPost,
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
  getRequiredParam,
} from "~/utils";
import { updateCookieWithPerPage, userPrefs } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { bookingStatusColorMap } from "./bookings._index";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);

  const teamMembers = await db.teamMember.findMany({
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
  });
  const booking = {
    status: "DRAFT",
    assets: [],
    name: "Booking XYZ",
    id: 1,
    from: { date: "12 Jul 2024", day: "Tue", time: "10:00" },
    to: { date: "14 Jul 2024", day: "Fri", time: "20:00" },
    custodian: "Olivia Rhye",
  };

  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam } = getParamsValues(searchParams);
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;
  const modelName = {
    singular: "asset",
    plural: "assets",
  };
  const totalItems = 0;
  const totalPages = 1 / perPage;
  const { prev, next } = generatePageMeta(request);

  const header: HeaderData = {
    title: `Edit | ${booking.name}`,
  };

  return json(
    {
      header,
      booking,
      modelName,
      items: booking.assets,
      page,
      totalItems,
      perPage,
      totalPages,
      next,
      prev,
      teamMembers,
    },
    {
      headers: {
        "Set-Cookie": await userPrefs.serialize(cookie),
      },
    }
  );
}

// export const meta: MetaFunction<typeof loader> = ({ data }) => [
//   { title: data ? appendToMetaTitle(data.header.title) : "" },
// ];

export const handle = {
  breadcrumb: () => "Edit",
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);

  const id = getRequiredParam(params, "bookingId");
  const formData = await request.formData();
  const result = await NewBookingFormSchema.safeParseAsync(
    parseFormAny(formData)
  );

  if (!result.success) {
    return json(
      {
        errors: result.error,
        success: false,
      },
      {
        status: 400,
        headers: {
          "Set-Cookie": await commitAuthSession(request, { authSession }),
        },
      }
    );
  }

  const { name, startDate, endDate, custodianId } = result.data;

  // await updateLocation({
  //   id,
  //   userId: authSession.userId,
  //   name,
  //   description,
  //   address,
  //   image: file || null,
  //   organizationId,
  // });

  sendNotification({
    title: "Location updated",
    message: "Your location  has been updated successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return json(
    { success: true },
    {
      headers: {
        "Set-Cookie": await commitAuthSession(request, { authSession }),
      },
    }
  );
}

export default function BookingEditPage() {
  const name = useAtomValue(dynamicTitleAtom);
  const hasName = name !== "";
  const { booking } = useLoaderData<typeof loader>();

  return (
    <>
      <Header title={hasName ? name : booking.name} />
      <div className="mr-auto">
        <Badge color={bookingStatusColorMap[booking.status]}>Draft</Badge>
      </div>
      <div>
        <BookingForm />
        <ContextualModal />
      </div>
    </>
  );
}
