import type { Prisma } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getBarcodeAddonPrices } from "~/modules/barcode/addon.server";
import { getUserByID } from "~/modules/user/service.server";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import {
  customerHasPaymentMethod,
  getOrCreateCustomerId,
} from "~/utils/stripe.server";

export async function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId, email } = authSession;

  try {
    const [prices, user] = await Promise.all([
      getBarcodeAddonPrices(),
      getUserByID(userId, {
        select: {
          id: true,
          email: true,
          customerId: true,
          firstName: true,
          lastName: true,
        } satisfies Prisma.UserSelect,
      }),
    ]);

    const customerId = await getOrCreateCustomerId({
      ...user,
      email: user.email || email,
    });

    const hasPaymentMethod = await customerHasPaymentMethod(customerId);

    return data({ ...prices, hasPaymentMethod });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
