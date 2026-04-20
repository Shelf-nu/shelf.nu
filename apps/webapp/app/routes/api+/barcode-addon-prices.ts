import type { Prisma } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getBarcodeAddonPrices } from "~/modules/barcode/addon.server";
import { getUserByID } from "~/modules/user/service.server";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import { customerHasPaymentMethod } from "~/utils/stripe.server";

export async function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const [prices, user] = await Promise.all([
      getBarcodeAddonPrices(),
      getUserByID(userId, {
        select: {
          customerId: true,
        } satisfies Prisma.UserSelect,
      }),
    ]);

    const hasPaymentMethod = user.customerId
      ? await customerHasPaymentMethod(user.customerId)
      : false;

    return data({ ...prices, hasPaymentMethod });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
