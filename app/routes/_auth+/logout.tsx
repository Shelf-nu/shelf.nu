import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { assertIsPost } from "~/utils";

export async function action({ context, request }: ActionFunctionArgs) {
  assertIsPost(request);
  context.destroySession();
  return redirect("/login");
}

export async function loader() {
  return redirect("/");
}
