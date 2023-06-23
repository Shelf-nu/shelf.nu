import type { ActionArgs, V2_MetaFunction } from "@remix-run/node";
import { json, type LoaderArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { titleAtom } from "~/atoms/locations.new";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { LocationForm, NewLocationFormSchema } from "~/components/location";
import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { getLocation, updateLocation } from "~/modules/location";
import { assertIsPost, getRequiredParam } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";

export async function loader({ request, params }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);

  const id = getRequiredParam(params, "locationId");

  const location = await getLocation({ userId, id });
  if (!location) {
    throw new Response("Not Found", { status: 404 });
  }

  const header: HeaderData = {
    title: `Edit | ${location.name}`,
  };

  return json({
    location,
    header,
  });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Edit",
};

export async function action({ request, params }: ActionArgs) {
  assertIsPost(request);
  const authSession = await requireAuthSession(request);

  const id = getRequiredParam(params, "locationId");
  const formData = await request.formData();
  const result = await NewLocationFormSchema.safeParseAsync(
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

  const { name, description, address } = result.data;

  await updateLocation({
    id,
    name,
    description,
    address,
  });

  sendNotification({
    title: "Location updated",
    message: "Your location  has been updated successfully",
    icon: { name: "success", variant: "success" },
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

export default function AssetEditPage() {
  const name = useAtomValue(titleAtom);
  const { location } = useLoaderData<typeof loader>();

  return (
    <>
      <Header title={location.name} />
      <div className=" items-top flex justify-between">
        <LocationForm
          name={location.name || name}
          description={location.description}
          address={location.address}
        />
      </div>
    </>
  );
}
