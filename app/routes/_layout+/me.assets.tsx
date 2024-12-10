import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}
