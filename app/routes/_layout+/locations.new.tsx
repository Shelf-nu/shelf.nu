import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import {
  json,
  redirect,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import { invariant } from "framer-motion";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";

import Header from "~/components/layout/header";
import { LocationForm, NewLocationFormSchema } from "~/components/location";

import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { createLocation } from "~/modules/location";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { assertIsPost } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
const title = "New Location";

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

export const MAX_SIZE = 1024 * 1024 * 4; // 4MB

export async function action({ request }: ActionFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  assertIsPost(request);

  /** Here we need to clone the request as we need 2 different streams:
   * 1. Access form data for creating asset
   * 2. Access form data via upload handler to be able to upload the file
   *
   * This solution is based on : https://github.com/remix-run/remix/issues/3971#issuecomment-1222127635
   */
  const clonedRequest = request.clone();

  const formData = await clonedRequest.formData();

  const result = await NewLocationFormSchema.safeParseAsync(
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

  const { name, description, address } = result.data;
  /** This checks if tags are passed and build the  */

  const formDataFile = await unstable_parseMultipartFormData(
    request,
    unstable_createMemoryUploadHandler({ maxPartSize: MAX_SIZE })
  );

  const file = formDataFile.get("image") as File | null;
  invariant(file instanceof File, "file not the right type");

  const rsp = await createLocation({
    name,
    description,
    address,
    userId: authSession.userId,
    organizationId,
    image: file || null,
  });

  // Handle unique constraint error for name
  if (rsp.error) {
    return json(
      {
        errors: {
          name: rsp.error,
        },
      },
      {
        status: 400,
        headers: [setCookie(await commitAuthSession(request, { authSession }))],
      }
    );
  }
  const { location } = rsp;

  sendNotification({
    title: "Location created",
    message: "Your location has been created successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return redirect(`/locations/${location.id}`, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function NewLocationPage() {
  const title = useAtomValue(dynamicTitleAtom);

  return (
    <>
      <Header title={title ? title : "Untitled location"} />
      <div>
        <LocationForm />
      </div>
    </>
  );
}
