import { type ActionFunctionArgs, redirect } from "@remix-run/node";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { setCookie } from "~/utils/cookies.server";
import { ShelfStackError } from "~/utils/error";

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const organizationId = formData.get("organizationId");
  if (!organizationId)
    // @TODO Solve error handling
    throw new ShelfStackError({ message: "Organization ID is required" });

  return redirect("/", {
    headers: [
      setCookie(
        await setSelectedOrganizationIdCookie(organizationId as string)
      ),
    ],
  });
};
