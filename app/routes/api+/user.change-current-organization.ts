import { type ActionFunctionArgs, redirect, json } from "@remix-run/node";
import { z } from "zod";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { setCookie } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { error, parseData } from "~/utils/http.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, redirectTo } = parseData(
      await request.formData(),
      z.object({
        organizationId: z.string(),
        redirectTo: z.string().optional(),
      })
    );

    return redirect(redirectTo ?? "/", {
      headers: [
        setCookie(await setSelectedOrganizationIdCookie(organizationId)),
      ],
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
