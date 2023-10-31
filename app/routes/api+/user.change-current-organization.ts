import { type ActionFunctionArgs, redirect } from "@remix-run/node";
import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { setCookie } from "~/utils/cookies.server";
import { ShelfStackError } from "~/utils/error";

export const action = async ({ request }: ActionFunctionArgs) => {
  const authSession = await requireAuthSession(request);
  const formData = await request.formData();
  const organizationId = formData.get("organizationId");
  if (!organizationId)
    throw new ShelfStackError({ message: "Organization ID is required" });

  return redirect("/", {
    headers: [
      setCookie(
        await setSelectedOrganizationIdCookie(organizationId as string)
      ),
      setCookie(
        await commitAuthSession(request, {
          authSession,
        })
      ),
    ],
  });
};
