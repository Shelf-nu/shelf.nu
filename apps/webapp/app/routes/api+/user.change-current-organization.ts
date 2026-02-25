import { type ActionFunctionArgs, redirect, data } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { setCookie } from "~/utils/cookies.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, parseData, safeRedirect } from "~/utils/http.server";
import { Logger } from "~/utils/logger";

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

    // Verify the user is a member of the target organization
    const membership = await db.userOrganization.findUnique({
      where: {
        userId_organizationId: { userId, organizationId },
      },
      select: { id: true },
    });

    if (!membership) {
      throw new ShelfError({
        cause: null,
        message: "You are not a member of this organization.",
        status: 403,
        label: "Organization",
      });
    }

    // Best-effort persist to database for cross-device workspace persistence.
    // Uses raw SQL to avoid bumping the User.updatedAt timestamp.
    try {
      await db.$executeRaw`
        UPDATE "User"
        SET "lastSelectedOrganizationId" = ${organizationId}
        WHERE "id" = ${userId}
      `;
    } catch (cause) {
      Logger.warn(
        "Failed to persist lastSelectedOrganizationId",
        userId,
        organizationId,
        cause
      );
    }

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
