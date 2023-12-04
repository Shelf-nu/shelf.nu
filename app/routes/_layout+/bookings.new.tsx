import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { BookingForm, NewBookingFormSchema } from "~/components/booking";
import ContextualModal from "~/components/layout/contextual-modal";

import Header from "~/components/layout/header";
import { Badge } from "~/components/shared";
import { db } from "~/database";

import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import {
  assertIsPost,
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { updateCookieWithPerPage, userPrefs } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { bookingStatusColorMap } from "./bookings._index";
const title = "New Booking";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);

  const header = {
    title,
  };

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
  const booking = { status: "DRAFT", assets: [] };

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

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>{title}</span>,
};

export async function action({ request }: ActionFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  assertIsPost(request);

  const formData = await request.formData();
  const result = await NewBookingFormSchema.safeParseAsync(
    parseFormAny(formData)
  );

  if (!result.success) {
    return json(
      {
        errors: result.error,
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
  /** This checks if tags are passed and build the  */

  // const location = await createLocation({
  //   name,
  //   description,
  //   address,
  //   userId: authSession.userId,
  //   organizationId,
  //   image: file || null,
  // });

  sendNotification({
    title: "Location created",
    message: "Your location has been created successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  // return redirect(`/locations/${location.id}`, {
  //   headers: {
  //     "Set-Cookie": await commitAuthSession(request, { authSession }),
  //   },
  // });
  return null;
}

export default function NewBookingPage() {
  const title = useAtomValue(dynamicTitleAtom);
  const { booking } = useLoaderData<typeof loader>();

  return (
    <>
      <Header title={title ? title : "Untitled booking"} />
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
