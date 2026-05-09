import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export function loader({ context }: LoaderFunctionArgs) {
  context.destroySession();
  return redirect("/portal");
}

export function action({ context }: ActionFunctionArgs) {
  context.destroySession();
  return redirect("/portal");
}
