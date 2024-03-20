import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export const loader = ({ context }: LoaderFunctionArgs) => {
  if (context.isAuthenticated) {
    return redirect("/assets");
  }

  return redirect("/login");
};

export default function Route() {
  return null;
}
