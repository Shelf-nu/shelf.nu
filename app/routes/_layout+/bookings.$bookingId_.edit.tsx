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
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { assertIsPost, getRequiredParam } from "~/utils";
import { sendNotification } from "~/utils/emitter/send-notification.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const id = getRequiredParam(params, "locationId");

  // const { location } = await getLocation({ organizationId, id });
  // if (!location) {
  //   throw new ShelfStackError({ message: "Location Not Found", status: 404 });
  // }

  // const header: HeaderData = {
  //   title: `Edit | ${location.name}`,
  // };

  return json({
    booking: {},
    // header,
  });
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
      {/* <Header title={hasName ? name : booking.name} /> */}
      <div className=" items-top flex justify-between">
        <BookingForm
          name={""}
          startDate={undefined}
          endDate={undefined}
          custodianId={""}
        />
      </div>
    </>
  );
}
