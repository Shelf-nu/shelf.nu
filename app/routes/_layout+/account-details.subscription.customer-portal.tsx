import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { db } from "~/database/db.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { createBillingPortalSession } from "~/utils/stripe.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.subscription,
      action: PermissionAction.update,
    });

    const user = await db.user
      .findUnique({
        where: { id: authSession.userId },
        select: { customerId: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong fetching the user. Please try again or contact support.",
          additionalData: { userId },
          label: "Subscription",
        });
      });

    if (!user?.customerId) {
      throw new ShelfError({
        cause: null,
        message: "No customer ID found for user",
        additionalData: { userId },
        label: "Subscription",
      });
    }

    const { url } = await createBillingPortalSession({
      customerId: user.customerId,
    });

    return redirect(url);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
