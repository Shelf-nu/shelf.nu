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
import {
  createBillingPortalSession,
  getOrCreateCustomerId,
} from "~/utils/stripe.server";

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
      .findUniqueOrThrow({
        where: { id: authSession.userId },
        select: {
          email: true,
          firstName: true,
          lastName: true,
          customerId: true,
        },
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

    const customerId = await getOrCreateCustomerId({
      id: userId,
      ...user,
    });

    const { url } = await createBillingPortalSession({
      customerId,
    });

    return redirect(url);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
