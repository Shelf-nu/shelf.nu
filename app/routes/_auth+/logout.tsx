import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { assertIsPost } from "~/utils/http.server";

export function action({ context, request }: ActionFunctionArgs) {
  assertIsPost(request);
  context.destroySession();
  return redirect("/login");
}

export function loader() {
  return redirect("/");
}
