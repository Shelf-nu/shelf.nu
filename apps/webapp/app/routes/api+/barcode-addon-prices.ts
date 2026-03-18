import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getBarcodeAddonPrices } from "~/modules/barcode/addon.server";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";

export async function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const prices = await getBarcodeAddonPrices();
    return data(prices);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
