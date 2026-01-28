import { type ActionFunctionArgs, redirect, data } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { setCookie } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { error, parseData, safeRedirect } from "~/utils/http.server";

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

    // Persist to database for cross-device workspace persistence
    await db.user.update({
      where: { id: userId },
      data: { lastSelectedOrganizationId: organizationId },
    });

    return redirect(safeRedirect(redirectTo), {
      headers: [
        setCookie(await setSelectedOrganizationIdCookie(organizationId)),
      ],
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
