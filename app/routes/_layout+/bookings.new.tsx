import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { BookingForm, BookingFormSchema } from "~/components/booking";

import Header from "~/components/layout/header";

import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { assertIsPost } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
const title = "New Booking";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuthSession(request);

  const header = {
    title,
  };

  return json({ header });
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
  const result = await BookingFormSchema.safeParseAsync(parseFormAny(formData));

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

  return (
    <>
      <Header title={title ? title : "Untitled booking"} />
      <div>
        <BookingForm />
      </div>
    </>
  );
}
