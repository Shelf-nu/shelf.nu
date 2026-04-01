/**
 * SSO Pending Assignment page.
 *
 * Displayed when an SSO user has no team workspace assigned. This can
 * happen on first login (no SCIM groups matched) or when all group
 * access has been revoked. The loader re-checks for team orgs on each
 * visit so the user is automatically redirected once an admin assigns
 * them. Uses the `_welcome+` layout for a centered, standalone card.
 */
import type { Prisma } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, redirect } from "react-router";
import { ShelfSymbolLogo } from "~/components/marketing/logos";
import { Button } from "~/components/shared/button";
import { getUserOrganizations } from "~/modules/organization/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Workspace Assignment Pending") },
];

/**
 * Loader verifies the user is an SSO user with no team organizations.
 * If they have team orgs (e.g. admin assigned them since last visit),
 * redirects to the main app. Non-SSO users are redirected away.
 */
export async function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const user = await getUserByID(userId, {
    select: { sso: true } satisfies Prisma.UserSelect,
  });

  if (!user.sso) {
    return redirect("/assets");
  }

  // Check if user now has team orgs
  const userOrgs = await getUserOrganizations({ userId });
  const teamOrgs = userOrgs.filter((uo) => uo.organization.type !== "PERSONAL");

  if (teamOrgs.length > 0) {
    return redirect("/assets");
  }

  return null;
}

export default function SsoPendingAssignment() {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center md:px-12">
      <ShelfSymbolLogo className="mb-6 size-12" />

      <h1 className="mb-2 text-[24px] font-semibold">No workspace assigned</h1>

      <p className="mx-auto mb-6 max-w-md text-gray-600">
        You don&apos;t currently have access to any workspace in Shelf. This
        usually means your administrator hasn&apos;t assigned you to one yet.
      </p>

      <p className="mx-auto mb-8 max-w-md text-sm text-gray-500">
        Contact your IT administrator to request access. Once they&apos;ve
        updated your group assignments, log out and log back in for the changes
        to take effect.
      </p>

      <Form method="post" action="/logout">
        <Button type="submit" variant="secondary">
          Log out
        </Button>
      </Form>
    </div>
  );
}
