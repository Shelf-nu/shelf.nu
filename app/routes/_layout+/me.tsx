import { json } from "@remix-run/node";
import type { MetaArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import Header from "~/components/layout/header";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import type { Item } from "~/components/layout/horizontal-tabs/types";
import { getUserWithContact } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";

export async function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    const user = await getUserWithContact(userId);

    const userName = `${user.firstName?.trim()} ${user.lastName?.trim()}`;

    const header = { title: userName };

    return json(data({ header, user, userName }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => "My profile",
};

export function meta({ data }: MetaArgs<typeof loader>) {
  return [{ title: data ? appendToMetaTitle(data.header.title) : "" }];
}

export default function Me() {
  const { user } = useLoaderData<typeof loader>();
  const { contact } = user;
  const TABS: Item[] = [
    { to: "assets", content: "Assets" },
    { to: "bookings", content: "Bookings" },
  ];

  return (
    <>
      <Header
        slots={{
          "left-of-title": (
            <img
              src={
                user.profilePicture ?? "/static/images/asset-placeholder.jpg"
              }
              alt="team-member"
              className="mr-4 size-14 rounded"
            />
          ),
        }}
        subHeading={
          <div>
            <span>
              {user.email} &bull; {contact.phone} &bull;{" "}
              {[
                contact.street,
                contact.city,
                contact.stateProvince,
                contact.zipPostalCode,
                contact.countryRegion,
              ]
                .filter(Boolean)
                .join(", ") || "No address provided"}
            </span>
          </div>
        }
      />
      <HorizontalTabs items={TABS} />
      <Outlet />
    </>
  );
}
