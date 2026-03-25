import type { MetaArgs, LoaderFunctionArgs } from "react-router";
import { data, Outlet, useLoaderData } from "react-router";
import Header from "~/components/layout/header";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import type { Item } from "~/components/layout/horizontal-tabs/types";
import { Button } from "~/components/shared/button";
import { UserSubheading } from "~/components/user/user-subheading";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getUserWithContact } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { resolveUserDisplayName } from "~/utils/user";

export async function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    const user = await getUserWithContact(userId);

    const userName = resolveUserDisplayName(user);

    const header = { title: userName };

    return payload({ header, user, userName });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
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
  const { roles } = useUserRoleHelper();

  /* Notes tab is only visible to ADMIN/OWNER roles.
   * Allows admins to see notes other admins have placed on their profile. */
  const canReadNotes = userHasPermission({
    roles,
    entity: PermissionEntity.teamMemberNote,
    action: PermissionAction.read,
  });

  const TABS: Item[] = [
    { to: "assets", content: "Assets" },
    { to: "bookings", content: "Bookings" },
    ...(canReadNotes ? [{ to: "notes", content: "Notes" }] : []),
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
          "right-of-title": (
            <Button
              variant="secondary"
              icon="pen"
              to={`/account-details/general`}
              className={"ml-auto"}
            >
              Edit
            </Button>
          ),
        }}
        subHeading={<UserSubheading user={user} />}
      />
      <HorizontalTabs items={TABS} className="mb-0" />
      <Outlet />
    </>
  );
}
